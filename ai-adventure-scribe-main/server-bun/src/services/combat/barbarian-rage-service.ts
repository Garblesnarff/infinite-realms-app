/**
 * Rage in a fight (#1638, 2014 SRD 5.1, the reduced first scope).
 *
 * A Barbarian spends one use and the bonus action to rage. While raging, which lasts 10 rounds or
 * until the fight ends, the engine adds +2 damage to melee Strength weapon attacks (Barbarian
 * levels 1 to 8) and halves bludgeoning, piercing and slashing damage taken. The raging mark lives
 * in the per-fight flags of combat-turn-flags.ts; the use is spent through the counted-feature ledger.
 *
 * The database client loads on first use, as in combat-turn-flags.ts, so the attack path can import
 * this module in tests that have no database.
 */
import { and, eq } from 'drizzle-orm';

import { claimRage, clearRage, classLevelOfCharacter } from './combat-turn-flags.js';
import { characters } from '../../../../db/schema/index';
import { familyCountRule } from '../../../../shared/limited-feature-counts';
import { BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { db as DatabaseClient } from '../../../../db/client';

export const RAGE_NAME = 'Rage';
const BARBARIAN = 'Barbarian';

export interface RageResult {
  usesRemaining: number;
  expiresRound: number;
}

/**
 * Whether the Rage chip is offered: a use is left on the sheet and this fight has no live Rage.
 * The chip is hidden when the server would refuse, so it is never a trap.
 */
export async function rageIsOffered(input: {
  characterId: string;
  userId: string;
  participantId: string;
  encounterId: string;
}): Promise<boolean> {
  const { countedFamilyPool } = await import('../progression/limited-feature-uses.js');
  const pool = await countedFamilyPool({
    characterId: input.characterId,
    userId: input.userId,
    className: BARBARIAN,
    family: 'barbarian-rage',
    includeUnlimited: true,
  });
  const { hasActiveRage } = await import('./combat-turn-flags.js');

  return Boolean(pool && pool.remaining > 0) &&
    !(await hasActiveRage(input.encounterId, input.participantId));
}

async function database(): Promise<typeof DatabaseClient> {
  return (await import('../../../../db/client')).db;
}

/**
 * Activate Rage: claim the raging mark for this encounter, then spend one use. A refusal before the
 * claim spends nothing; a refusal after it clears the mark. The caller's claim refunds the bonus action.
 */
export async function resolveRage(input: {
  characterId: string;
  userId: string;
  participantId: string;
  encounterId: string;
}): Promise<RageResult> {
  const { characterId, userId, participantId, encounterId } = input;
  const db = await database();
  const [owned] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)))
    .limit(1);
  const level = owned ? await classLevelOfCharacter(characterId, BARBARIAN) : 0;
  if (level <= 0) {
    throw new BusinessLogicError(`${RAGE_NAME} is not on this character's sheet`, {
      reason: 'feature_not_on_sheet',
      featureName: RAGE_NAME,
    });
  }

  // The mark's expiry is computed from the encounter's round in the same statement that writes it.
  const expiresRound = await claimRage(encounterId, participantId);
  if (expiresRound === null) {
    throw new BusinessLogicError('Already raging in this fight', {
      reason: 'already_raging',
      featureName: RAGE_NAME,
    });
  }

  try {
    const rule = familyCountRule('barbarian-rage');
    if (!rule) throw new Error('barbarian-rage count rule is missing');
    const { spendCountedFeatureUse } = await import('../progression/limited-feature-uses.js');
    const spend = await spendCountedFeatureUse({
      characterId,
      userId,
      className: BARBARIAN,
      featureName: RAGE_NAME,
      rule,
    });
    if (!spend.ok) {
      throw new BusinessLogicError(spend.reason, {
        reason: 'no_uses_left',
        featureName: RAGE_NAME,
      });
    }
    return { usesRemaining: spend.usesRemaining, expiresRound };
  } catch (error) {
    // The original refusal or failure is the one the caller sees. A failed cleanup is logged,
    // because the mark it could not clear is then a stranded Rage until the fight ends.
    try {
      await clearRage(encounterId, participantId);
    } catch (clearError) {
      logger.error({
        msg: 'RAGE_CLEAR_FAILED',
        encounterId,
        participantId,
        error: clearError,
      });
    }
    throw error;
  }
}
