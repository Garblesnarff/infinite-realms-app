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
type VitalsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
 * Read a character's vitals, locking the row when the caller is about to write it.
 *
 * 🛡️ Sentinel: ownership lives in this statement's WHERE clause, not in a separate
 * check, so there is no window between "may I" and "I did". A character the caller does
 * not own reads as absent, which is what the caller reports.
 */
async function loadOwnedVitals(
  tx: VitalsTx,
  characterId: string,
  userId: string,
  forUpdate: boolean,
): Promise<CharacterVitals | null> {
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
    .where(
      and(
        eq(characterStats.characterId, characterId),
        exists(
          tx
            .select({ one: sql`1` })
            .from(characters)
            .where(
              and(
                eq(characters.id, characterStats.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
              ),
            ),
        ),
      ),
    )
    .limit(1);

  const [row] = await (forUpdate ? query.for('update') : query);
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
      const current = await loadOwnedVitals(tx, characterId, userId, false);
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
      const current = await loadOwnedVitals(tx, characterId, userId, true);
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
      const current = await loadOwnedVitals(tx, characterId, userId, true);
      if (!current) throw notFound();

      return writeVitals(
        tx,
        characterId,
        current.maxHitPoints,
        computeVitalsAfterHeal(current, amount),
      );
    });
  }
}
