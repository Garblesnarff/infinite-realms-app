/**
 * Character Vitals Service
 *
 * The single writer for a character's hit points, consciousness and death-save state.
 *
 * Before this existed, consciousness and death were properties of a combat encounter:
 * `combat_participant_status` holds `is_conscious` and the death-save counters, and that
 * row only exists while a `combat_participants` row does. A character who dove into a
 * chasm, failed the check, and was narrated as "down" had nowhere for that to be
 * recorded, so play continued at full health (#1826). These methods write the
 * character-scoped columns added in the same PR, so a character can be unconscious
 * whether or not a fight is running.
 *
 * Combat writes through here too. `CombatHPService` calls `mirrorFromCombat` inside its own
 * transaction, so `combat_participant_status` is a synchronous write-through cache of the
 * character record rather than a second, independent owner of a character's hit points. That
 * is what closes the mirror bug: the participant row used to absorb every hit of a fight and
 * then vanish with the encounter, leaving the sheet at whatever it said when combat started.
 *
 * The arithmetic is not re-implemented here: damage and healing go through
 * `HPMechanics`, the same pure functions combat uses, so the two paths cannot drift.
 *
 * Deliberately NOT in this service (PR3 of the #1826 plan): death-save progression,
 * ledger/telemetry writes, and conditions CRUD.
 *
 * @module server/services/character-vitals-service
 */

import { TRPCError } from '@trpc/server';
import { and, eq, exists, or, sql } from 'drizzle-orm';

import {
  computeVitalsAfterDamage,
  computeVitalsAfterHeal,
  type CharacterVitals,
  type CombatResolvedVitals,
  type VitalsWrite,
} from './character-vitals-math.js';
import {
  relentlessEnduranceLine,
  spendRelentlessEndurance,
  wouldRelentlessEnduranceTrigger,
} from './combat/relentless-endurance.js';
import { resolveDeathSave } from './session/death-save-resolution.js';
import { db } from '../../../db/client';
import { characterStats, characters } from '../../../db/schema/index';
import { DEATH_SAVE_LIMIT } from '../../../shared/death-save-limit.js';

import type { VitalState } from '../../../db/schema/index';

export type {
  CharacterVitals,
  VitalsWrite,
  CombatResolvedVitals,
} from './character-vitals-math.js';
export { computeVitalsAfterDamage, computeVitalsAfterHeal } from './character-vitals-math.js';

/** The transaction handle Drizzle hands to `db.transaction`'s callback. */
export type VitalsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The body state a combat-resolved outcome leaves the character in.
 *
 * Reads the same way `vitalStateOf` in the combat engine does, from hit points and the two
 * counters, so a character's sheet and their place in the turn order cannot disagree about
 * whether they are dying.
 */
function vitalStateAfterCombat(
  current: CharacterVitals,
  resolved: CombatResolvedVitals,
): VitalState {
  if (resolved.vitalState) return resolved.vitalState;
  // Death is terminal here. Combat's healing math has no concept of it —
  // `calculateHealingResult` will happily put a dead participant back on 1 HP — so the mirror
  // records the hit points combat wrote without quietly resurrecting anyone. Raising the dead
  // is PR3.
  if (current.vitalState === 'dead') return 'dead';
  if (resolved.currentHitPoints > 0) return 'standing';
  if (resolved.deathSavesFailures >= DEATH_SAVE_LIMIT) return 'dead';
  if (resolved.deathSavesSuccesses >= DEATH_SAVE_LIMIT) return 'stabilized';
  return 'dying';
}

/**
 * The owner predicate shared by the vitals read and the vitals write.
 *
 * 🛡️ Sentinel: when `userId` is given, ownership lives in the statement's WHERE clause, not in
 * a separate check, so there is no window between "may I" and "I did". A character the caller
 * does not own matches nothing.
 *
 * `userId` is omitted only by the combat mirror, which has no user to check against — a
 * monster's turn runs server-side with no caller at all — and whose authorization is enforced
 * by the participant statement sharing its transaction. See `mirrorFromCombat`.
 */
function ownedByCaller(
  tx: VitalsTx,
  userId: string | undefined,
): ReturnType<typeof exists> | undefined {
  if (!userId) return undefined;
  return exists(
    tx
      .select({ one: sql`1` })
      .from(characters)
      .where(
        and(
          eq(characters.id, characterStats.characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      ),
  );
}

/**
 * Read a character's vitals, optionally scoped to an owner, locking the row when the caller is
 * about to write it.
 */
async function loadVitals(
  tx: VitalsTx,
  characterId: string,
  options: { userId?: string; forUpdate: boolean },
): Promise<CharacterVitals | null> {
  const ownedByCallerClause = ownedByCaller(tx, options.userId);

  const query = tx
    .select({
      characterId: characterStats.characterId,
      currentHitPoints: characterStats.currentHitPoints,
      maxHitPoints: characterStats.maxHitPoints,
      temporaryHitPoints: characterStats.temporaryHitPoints,
      isConscious: characterStats.isConscious,
      deathSavesSuccesses: characterStats.deathSavesSuccesses,
      deathSavesFailures: characterStats.deathSavesFailures,
      vitalState: characterStats.vitalState,
      diedAt: characterStats.diedAt,
    })
    .from(characterStats)
    .where(and(eq(characterStats.characterId, characterId), ownedByCallerClause))
    .limit(1);

  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row) return null;

  return {
    characterId: row.characterId,
    currentHitPoints: row.currentHitPoints,
    maxHitPoints: row.maxHitPoints,
    temporaryHitPoints: row.temporaryHitPoints ?? 0,
    isConscious: row.isConscious,
    deathSavesSuccesses: row.deathSavesSuccesses,
    deathSavesFailures: row.deathSavesFailures,
    vitalState: row.vitalState,
    diedAt: row.diedAt ?? null,
  };
}

function notFound(): TRPCError {
  // 🛡️ Sentinel: same error for "no such character" and "not yours" — the caller cannot
  // learn which from the response.
  return new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
}

async function writeVitals(
  tx: VitalsTx,
  characterId: string,
  maxHitPoints: number,
  next: VitalsWrite,
  userId?: string,
): Promise<CharacterVitals> {
  const [updated] = await tx
    .update(characterStats)
    .set({
      currentHitPoints: next.currentHitPoints,
      temporaryHitPoints: next.temporaryHitPoints,
      isConscious: next.isConscious,
      vitalState: next.vitalState,
      deathSavesSuccesses: next.deathSavesSuccesses,
      deathSavesFailures: next.deathSavesFailures,
      // Absent unless the caller has a reason to move it, so no path can clear a death
      // timestamp by omission.
      ...(next.diedAt === undefined ? {} : { diedAt: next.diedAt }),
      updatedAt: new Date(),
    })
    .where(and(eq(characterStats.characterId, characterId), ownedByCaller(tx, userId)))
    .returning({
      currentHitPoints: characterStats.currentHitPoints,
      temporaryHitPoints: characterStats.temporaryHitPoints,
      isConscious: characterStats.isConscious,
      deathSavesSuccesses: characterStats.deathSavesSuccesses,
      deathSavesFailures: characterStats.deathSavesFailures,
      vitalState: characterStats.vitalState,
      diedAt: characterStats.diedAt,
    });

  if (!updated) throw notFound();

  return {
    characterId,
    currentHitPoints: updated.currentHitPoints,
    maxHitPoints,
    temporaryHitPoints: updated.temporaryHitPoints ?? 0,
    isConscious: updated.isConscious,
    deathSavesSuccesses: updated.deathSavesSuccesses,
    deathSavesFailures: updated.deathSavesFailures,
    vitalState: updated.vitalState,
    diedAt: updated.diedAt ?? null,
  };
}

export class CharacterVitalsService {
  /**
   * Read a character's vitals. Rejects with NOT_FOUND for a character the user does not
   * own.
   */
  static async getVitals(characterId: string, userId: string): Promise<CharacterVitals> {
    return db.transaction(async (tx) => {
      const current = await loadVitals(tx, characterId, { userId, forUpdate: false });
      if (!current) throw notFound();
      return current;
    });
  }

  /**
   * Apply damage. Temporary hit points absorb it first, hit points floor at 0, and a
   * character who reaches 0 goes unconscious and starts dying.
   *
   * Read and write share one transaction with the row locked between them, so two
   * concurrent hits cannot both compute their new HP from the same starting value.
   */
  static async applyDamage(
    characterId: string,
    userId: string,
    amount: number,
    options: { critical?: boolean } = {},
  ): Promise<CharacterVitals & { relentlessEnduranceLine?: string }> {
    return db.transaction(async (tx) => {
      const current = await loadVitals(tx, characterId, { userId, forUpdate: true });
      if (!current) throw notFound();

      const next = computeVitalsAfterDamage(current, amount, options);

      // #1635: a Half-Orc dropped to 0 and not killed outright stays up at 1 HP, once per long
      // rest. Massive damage already reads as 'dead' here (computeVitalsAfterDamage), so the
      // vital state is the "killed outright" test; the spend shares this transaction.
      let final = next;
      let line: string | undefined;
      if (
        current.vitalState !== 'dead' &&
        wouldRelentlessEnduranceTrigger({
          hpBefore: current.currentHitPoints,
          newHp: next.currentHitPoints,
          massiveDamage: next.vitalState === 'dead',
          isDead: next.vitalState === 'dead',
        })
      ) {
        const spent = await spendRelentlessEndurance(tx, characterId);
        if (spent) {
          final = {
            ...next,
            currentHitPoints: 1,
            isConscious: true,
            vitalState: 'standing',
            deathSavesSuccesses: 0,
            deathSavesFailures: 0,
          };
          line = relentlessEnduranceLine(spent.characterName);
        }
      }

      const written = await writeVitals(tx, characterId, current.maxHitPoints, final, userId);
      return line ? { ...written, relentlessEnduranceLine: line } : written;
    });
  }

  /**
   * Apply healing. Healing that leaves the character above 0 HP revives them from dying
   * to standing and clears their death saves.
   *
   * A caller that passes its transaction gets the heal committed or rolled back with
   * its own writes.
   */
  static async heal(
    characterId: string,
    userId: string,
    amount: number,
    tx?: VitalsTx,
  ): Promise<CharacterVitals> {
    const run = async (t: VitalsTx): Promise<CharacterVitals> => {
      const current = await loadVitals(t, characterId, { userId, forUpdate: true });
      if (!current) throw notFound();

      return writeVitals(
        t,
        characterId,
        current.maxHitPoints,
        computeVitalsAfterHeal(current, amount),
        userId,
      );
    };
    if (tx) return run(tx);
    return db.transaction(run);
  }

  /**
   * Set temporary hit points. 2014 5e: temporary hit points do not stack —
   * the higher of the current and the new value wins (#214).
   */
  static async setTemporaryHitPoints(
    characterId: string,
    userId: string,
    amount: number,
  ): Promise<CharacterVitals> {
    return db.transaction(async (tx) => {
      const current = await loadVitals(tx, characterId, { userId, forUpdate: true });
      if (!current) throw notFound();

      return writeVitals(
        tx,
        characterId,
        current.maxHitPoints,
        {
          currentHitPoints: current.currentHitPoints,
          temporaryHitPoints: Math.max(current.temporaryHitPoints, Math.max(0, Math.trunc(amount))),
          isConscious: current.isConscious,
          vitalState: current.vitalState,
          deathSavesSuccesses: current.deathSavesSuccesses,
          deathSavesFailures: current.deathSavesFailures,
        },
        userId,
      );
    });
  }

  /**
   * Record a combat-resolved outcome on the character record, inside the caller's transaction.
   *
   * Server-internal: the only caller is `CombatHPService`, which opens the transaction, calls
   * this first, and then writes the participant mirror into the same one. Both writes commit
   * together or neither does.
   *
   * 🛡️ Sentinel: this method takes no `userId` and performs no ownership check of its own, and
   * that is deliberate rather than an omission. Two reasons. The `characterId` never comes from
   * a request — it is read off the `combat_participants` row the encounter seeded — and half of
   * the combat write paths run with no caller at all (a monster's turn). Authorization is the
   * job of the participant UPDATE that follows this call in the same transaction: it carries
   * the encounter ownership filter and throws when it matches nothing, which rolls this write
   * back before it can commit. Ordering matters for that reason and no other.
   *
   * Returns null when the character has no `character_stats` row — a data gap that predates
   * this path — so the caller can log it. Failing the write instead would turn a missing row
   * into a failed attack mid-fight.
   */
  static async mirrorFromCombat(
    tx: VitalsTx,
    characterId: string,
    resolved: CombatResolvedVitals,
  ): Promise<CharacterVitals | null> {
    const current = await loadVitals(tx, characterId, { forUpdate: true });
    if (!current) return null;

    const vitalState = vitalStateAfterCombat(current, resolved);

    return writeVitals(tx, characterId, current.maxHitPoints, {
      currentHitPoints: resolved.currentHitPoints,
      // Healing and death saves do not touch temporary hit points, and a mirror that
      // defaulted them to 0 would silently strip a buff combat still believes in.
      temporaryHitPoints: resolved.temporaryHitPoints ?? current.temporaryHitPoints,
      isConscious: resolved.isConscious,
      vitalState,
      deathSavesSuccesses: resolved.deathSavesSuccesses,
      deathSavesFailures: resolved.deathSavesFailures,
      // Stamped once, on the transition into death, and never cleared here. The death ledger
      // proper is PR3; a `vital_state` of 'dead' with no timestamp beside it would be a row
      // that cannot say when it happened.
      ...(vitalState === 'dead' && current.diedAt === null ? { diedAt: new Date() } : {}),
    });
  }

  /**
   * Resolve and record one death saving throw for a hero dying outside combat (#1811).
   * Rolls the d20 (and 1d4 on a third success) through the injected deps, applies the
   * tally progression through `HPMechanics.resolveDeathSave`, and writes the character
   * record with a compare-and-set on the current tallies.
   */
  static async applyDeathSave(
    characterId: string,
    userId: string,
    options: { name?: string; rollDie?: (sides: number) => number } = {},
  ): Promise<CharacterVitals & { resolution: ReturnType<typeof resolveDeathSave> }> {
    const rollDie = options.rollDie ?? (await import('../lib/rng.js')).rollDie;
    return db.transaction(async (tx) => {
      const current = await loadVitals(tx, characterId, { userId, forUpdate: true });
      if (!current) throw notFound();
      if (current.currentHitPoints !== 0 || current.vitalState !== 'dying') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Not dying',
        });
      }

      let charName = options.name;
      if (!charName) {
        const [row] = await tx
          .select({ name: characters.name })
          .from(characters)
          .where(eq(characters.id, characterId))
          .limit(1);
        charName = row?.name ?? 'You';
      }

      const natural = rollDie(20);
      let resolution = resolveDeathSave({ vitals: current, name: charName, natural });
      if (resolution.isStabilized) {
        const d4 = rollDie(4);
        resolution = resolveDeathSave({ vitals: current, name: charName, natural, d4 });
      }

      const diedAt = resolution.isDead
        ? current.diedAt === null
          ? new Date()
          : current.diedAt
        : current.diedAt;

      const [updated] = await tx
        .update(characterStats)
        .set({
          currentHitPoints: resolution.vitals.currentHitPoints,
          temporaryHitPoints: resolution.vitals.temporaryHitPoints,
          isConscious: resolution.vitals.isConscious,
          vitalState: resolution.vitals.vitalState,
          deathSavesSuccesses: resolution.vitals.deathSavesSuccesses,
          deathSavesFailures: resolution.vitals.deathSavesFailures,
          ...(resolution.vitals.diedAt === undefined
            ? diedAt === null
              ? {}
              : { diedAt }
            : { diedAt: resolution.vitals.diedAt }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characterStats.characterId, characterId),
            eq(characterStats.deathSavesSuccesses, current.deathSavesSuccesses),
            eq(characterStats.deathSavesFailures, current.deathSavesFailures),
            eq(characterStats.vitalState, 'dying'),
            eq(characterStats.currentHitPoints, 0),
            ownedByCaller(tx, userId)!,
          ),
        )
        .returning({
          currentHitPoints: characterStats.currentHitPoints,
          temporaryHitPoints: characterStats.temporaryHitPoints,
          isConscious: characterStats.isConscious,
          deathSavesSuccesses: characterStats.deathSavesSuccesses,
          deathSavesFailures: characterStats.deathSavesFailures,
          vitalState: characterStats.vitalState,
          diedAt: characterStats.diedAt,
        });

      if (!updated) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Compare-and-set failed',
        });
      }

      const written: CharacterVitals = {
        characterId,
        currentHitPoints: updated.currentHitPoints,
        maxHitPoints: current.maxHitPoints,
        temporaryHitPoints: updated.temporaryHitPoints ?? 0,
        isConscious: updated.isConscious,
        deathSavesSuccesses: updated.deathSavesSuccesses,
        deathSavesFailures: updated.deathSavesFailures,
        vitalState: updated.vitalState,
        diedAt: updated.diedAt ?? null,
      };

      return { ...written, resolution };
    });
  }
}
