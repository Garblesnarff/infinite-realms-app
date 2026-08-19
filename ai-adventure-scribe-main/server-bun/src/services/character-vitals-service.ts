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

import { HPMechanics } from './combat/hp-mechanics.js';
import { db } from '../../../db/client';
import { characterStats, characters } from '../../../db/schema/index';

import type { HPStatusInput } from './combat/hp-mechanics.js';
import type { VitalState } from '../../../db/schema/index';

/** The transaction handle Drizzle hands to `db.transaction`'s callback. */
export type VitalsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 5E: three failures kill, three successes stabilise.
 *
 * Spelled here rather than imported from `services/combat/death-saves-service.ts`, which owns
 * the same two thresholds: that module pulls in the encounter service and the initiative
 * service behind it, and this one has no business depending on the combat graph — combat
 * depends on it.
 */
const DEATH_SAVE_LIMIT = 3;

/** A character's full vital state, as read from or written to `character_stats`. */
export interface CharacterVitals {
  characterId: string;
  currentHitPoints: number;
  maxHitPoints: number;
  temporaryHitPoints: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  vitalState: VitalState;
  diedAt: Date | null;
}

/** The columns a vitals write is allowed to touch. */
export interface VitalsWrite {
  currentHitPoints: number;
  temporaryHitPoints: number;
  isConscious: boolean;
  vitalState: VitalState;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  /**
   * Left `undefined` by every out-of-combat path, and then not written at all. Only the
   * combat mirror below has a reason to stamp it, and only on the transition into `dead`.
   */
  diedAt?: Date | null;
}

/**
 * What combat resolved, in character-record terms.
 *
 * Deliberately not a damage or healing request: by the time combat calls the mirror it has
 * already run `HPMechanics` against the participant row — with that row's resistances, the
 * per-hit cap and the crit rules — and the character record's job is to record that outcome,
 * not to recompute it and risk landing somewhere else.
 */
export interface CombatResolvedVitals {
  currentHitPoints: number;
  /** Omitted by the paths that do not touch temporary hit points (healing, death saves). */
  temporaryHitPoints?: number;
  isConscious: boolean;
  deathSavesSuccesses: number;
  deathSavesFailures: number;
  /**
   * Set only where the counters cannot express the state combat reached. A successful Medicine
   * check clears both counters, which is indistinguishable from "dying, nothing rolled yet"
   * unless the state is named outright.
   */
  vitalState?: VitalState;
}

function toHpStatusInput(vitals: CharacterVitals): HPStatusInput {
  return {
    currentHp: vitals.currentHitPoints,
    maxHp: vitals.maxHitPoints,
    tempHp: vitals.temporaryHitPoints,
    isConscious: vitals.isConscious,
    deathSavesSuccesses: vitals.deathSavesSuccesses,
    deathSavesFailures: vitals.deathSavesFailures,
  };
}

/**
 * What a character's vitals become after taking `amount` damage.
 *
 * Exported for the regression test that pins the walking-corpse bug: 15 damage on an
 * 11 HP character must land at 0 and unconscious — never back at 11/11, never clamped
 * to 1.
 *
 * Two things `HPMechanics` offers are deliberately not used here:
 *
 * - `targetIsPlayer` (the half-max-HP per-hit cap) is NOT set. That cap is a combat
 *   safety net against a mis-scaled stat block deciding a fight on one roll. This path
 *   carries a number the DM already resolved — fall damage, a trap, a hazard — and
 *   silently halving it would re-create the defect this service exists to fix, one step
 *   further down.
 * - The death-save failures `HPMechanics` computes for damage taken at 0 HP are
 *   discarded. Death-save progression is PR3; PR1 only records that the character is
 *   down.
 *
 * Damage type is not applied either: the route carries a bare amount, so there is
 * nothing to match against a resistance list.
 */
export function computeVitalsAfterDamage(current: CharacterVitals, amount: number): VitalsWrite {
  const damageAmount = Math.max(0, Math.trunc(amount));
  const result = HPMechanics.calculateDamageResult(
    current.characterId,
    toHpStatusInput(current),
    {},
    { damageAmount },
  );

  let vitalState: VitalState = current.vitalState;
  if (result.newCurrentHp === 0 && current.vitalState !== 'dead') {
    // Includes a character who was already dying: they stay at 0 and stay dying. It also
    // covers a stabilized character taking a fresh hit, who starts dying again.
    vitalState = 'dying';
  }

  return {
    currentHitPoints: result.newCurrentHp,
    temporaryHitPoints: result.newTempHp,
    isConscious: result.isConscious,
    vitalState,
    // Unchanged on purpose — see the note above about PR3.
    deathSavesSuccesses: current.deathSavesSuccesses,
    deathSavesFailures: current.deathSavesFailures,
  };
}

/**
 * What a character's vitals become after being healed by `amount`.
 *
 * Any healing that leaves the character above 0 HP brings them back up: conscious,
 * standing, death saves cleared. A character whose `vital_state` is already `dead` is
 * left exactly as they are — raising the dead is a PR3 concern, and PR1 has no path that
 * can produce that state in the first place.
 */
export function computeVitalsAfterHeal(current: CharacterVitals, amount: number): VitalsWrite {
  const unchanged: VitalsWrite = {
    currentHitPoints: current.currentHitPoints,
    temporaryHitPoints: current.temporaryHitPoints,
    isConscious: current.isConscious,
    vitalState: current.vitalState,
    deathSavesSuccesses: current.deathSavesSuccesses,
    deathSavesFailures: current.deathSavesFailures,
  };

  if (current.vitalState === 'dead') return unchanged;

  const healingAmount = Math.max(0, Math.trunc(amount));
  const result = HPMechanics.calculateHealingResult(
    current.characterId,
    toHpStatusInput(current),
    healingAmount,
  );

  const isUpright = result.newCurrentHp > 0;

  return {
    ...unchanged,
    currentHitPoints: result.newCurrentHp,
    // 5E: healing restores hit points; temporary hit points are a separate pool and are
    // never topped up by it.
    temporaryHitPoints: current.temporaryHitPoints,
    isConscious: isUpright,
    vitalState: isUpright ? 'standing' : current.vitalState,
    deathSavesSuccesses: isUpright ? 0 : current.deathSavesSuccesses,
    deathSavesFailures: isUpright ? 0 : current.deathSavesFailures,
  };
}

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
 * Read a character's vitals, optionally scoped to an owner, locking the row when the caller is
 * about to write it.
 *
 * 🛡️ Sentinel: when `userId` is given, ownership lives in this statement's WHERE clause, not in
 * a separate check, so there is no window between "may I" and "I did". A character the caller
 * does not own reads as absent, which is what the caller reports.
 *
 * `userId` is omitted only by the combat mirror, which has no user to check against — a
 * monster's turn runs server-side with no caller at all — and whose authorization is enforced
 * by the participant statement sharing its transaction. See `mirrorFromCombat`.
 */
async function loadVitals(
  tx: VitalsTx,
  characterId: string,
  options: { userId?: string; forUpdate: boolean },
): Promise<CharacterVitals | null> {
  const ownedByCaller = options.userId
    ? exists(
        tx
          .select({ one: sql`1` })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterStats.characterId),
              or(eq(characters.userId, options.userId), eq(characters.ownerId, options.userId)),
            ),
          ),
      )
    : undefined;

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
    .where(and(eq(characterStats.characterId, characterId), ownedByCaller))
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
    .where(eq(characterStats.characterId, characterId))
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
  ): Promise<CharacterVitals> {
    return db.transaction(async (tx) => {
      const current = await loadVitals(tx, characterId, { userId, forUpdate: true });
      if (!current) throw notFound();

      return writeVitals(
        tx,
        characterId,
        current.maxHitPoints,
        computeVitalsAfterDamage(current, amount),
      );
    });
  }

  /**
   * Apply healing. Healing that leaves the character above 0 HP revives them from dying
   * to standing and clears their death saves.
   */
  static async heal(
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
        computeVitalsAfterHeal(current, amount),
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
}
