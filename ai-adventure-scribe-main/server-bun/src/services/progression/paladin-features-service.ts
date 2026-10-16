/**
 * Paladin feature pools (#712).
 *
 * Lay on Hands and Divine Sense exist in the SRD seed but had no mechanical effect
 * wired anywhere: the pool was never decremented, healing never applied, and uses
 * never tracked. This module owns the two features' pool mechanics:
 *
 * - Lay on Hands: a pool of (paladin level x 5) HP, replenished on a long rest.
 *   Resolving it heals a target against the pool and refuses clearly when empty.
 * - Divine Sense: 1 + CHA modifier uses per long rest (minimum 1).
 *
 * Both features are seeded with `uses_count = NULL`, which
 * ClassFeatureUsageService treats as unlimited. The pool state lives in
 * `character_features.uses_remaining`, initialized lazily on first use and reset
 * on a long rest (see `replenishPaladinPools`, called from `restoreFeatures`).
 * No migration: the seed rows already exist.
 *
 * @module server/services/progression/paladin-features-service
 */

import { and, eq, ilike, or } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  characterConditions,
  characterFeatures,
  characters,
  characterStats,
  classFeaturesLibrary,
  combatParticipantConditions,
  conditionsLibrary,
  type CharacterFeature,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { CharacterVitalsService } from '../character-vitals-service.js';
import { CombatHPService } from '../combat-hp-service.js';
import { ClassFeatureUsageService } from './class-feature-usage-service.js';

const PALADIN_CLASS = 'Paladin';
export const DIVINE_SENSE_NAME = 'Divine Sense';
export const LAY_ON_HANDS_NAME = 'Lay on Hands';

/** HP drawn from the pool to cure one disease or neutralize one poison (2014). */
const LAY_ON_HANDS_CURE_COST = 5;

type CharacterRow = typeof characters.$inferSelect;

/** Paladin levels: `classLevels` entries ({ className, level }) win; else class/level. */
export function paladinLevelOf(character: {
  class: string | null;
  level: number | null;
  classLevels: unknown;
}): number {
  const entries = Array.isArray(character.classLevels) ? character.classLevels : [];
  let multiclass = 0;
  for (const entry of entries) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { className?: unknown }).className === 'string' &&
      ((entry as { className: string }).className.toLowerCase() === 'paladin')
    ) {
      const entryLevel = (entry as { level?: unknown }).level;
      multiclass += typeof entryLevel === 'number' && entryLevel > 0 ? Math.trunc(entryLevel) : 0;
    }
  }
  if (multiclass > 0) return multiclass;
  return (character.class ?? '').toLowerCase() === 'paladin' ? (character.level ?? 0) : 0;
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

async function ownedCharacter(characterId: string, userId: string): Promise<CharacterRow | null> {
  const [character] = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  return character ?? null;
}

async function libraryFeatureId(featureName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: classFeaturesLibrary.id })
    .from(classFeaturesLibrary)
    .where(
      and(
        eq(classFeaturesLibrary.className, PALADIN_CLASS),
        eq(classFeaturesLibrary.featureName, featureName),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

async function poolRow(
  characterId: string,
  featureId: string,
  userId: string,
): Promise<CharacterFeature | null> {
  const [row] = await db
    .select({ characterFeature: characterFeatures })
    .from(characterFeatures)
    .innerJoin(characters, eq(characterFeatures.characterId, characters.id))
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  return row?.characterFeature ?? null;
}

/**
 * Find the character_features row for a pooled paladin feature, creating it when
 * the character was never granted the row, and initializing `usesRemaining` to
 * `maxPool` when it was granted as unlimited (the seed's NULL uses_count).
 * Returns null when the character is not this user's, not a paladin, or the
 * library row is missing.
 */
async function ensurePoolRow(
  characterId: string,
  userId: string,
  featureName: string,
  maxPool: number,
): Promise<{ row: CharacterFeature; featureId: string } | null> {
  const character = await ownedCharacter(characterId, userId);
  if (!character || paladinLevelOf(character) <= 0) return null;
  const featureId = await libraryFeatureId(featureName);
  if (!featureId) {
    logger.warn({ msg: 'PALADIN_POOL_NO_LIBRARY_ROW', characterId, featureName });
    return null;
  }

  const existing = await poolRow(characterId, featureId, userId);
  if (existing) {
    if (existing.usesRemaining === null) {
      const [updated] = await db
        .update(characterFeatures)
        .set({ usesRemaining: maxPool })
        .where(eq(characterFeatures.id, existing.id))
        .returning();
      return { row: updated ?? existing, featureId };
    }
    return { row: existing, featureId };
  }

  const [created] = await db
    .insert(characterFeatures)
    .values({
      characterId,
      featureId,
      usesRemaining: maxPool,
      isActive: true,
      acquiredAtLevel: character.level ?? 1,
    })
    .returning();
  if (!created) throw new NotFoundError('Character', characterId);
  return { row: created, featureId };
}

async function charismaModifier(characterId: string): Promise<number> {
  const [stats] = await db
    .select({ charisma: characterStats.charisma })
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId))
    .limit(1);
  return abilityModifier(stats?.charisma ?? 10);
}

export interface PoolState {
  max: number;
  remaining: number;
}

/** The Lay on Hands pool: max = paladin level x 5, remaining from the pool row. */
export async function layOnHandsPool(
  characterId: string,
  userId: string,
): Promise<(PoolState & { row: CharacterFeature; featureId: string; character: CharacterRow }) | null> {
  const character = await ownedCharacter(characterId, userId);
  if (!character) return null;
  const max = paladinLevelOf(character) * 5;
  if (max <= 0) return null;
  const ensured = await ensurePoolRow(characterId, userId, LAY_ON_HANDS_NAME, max);
  if (!ensured) return null;
  return {
    max,
    remaining: ensured.row.usesRemaining ?? max,
    row: ensured.row,
    featureId: ensured.featureId,
    character,
  };
}

/** Divine Sense uses: 1 + CHA modifier, minimum 1, per long rest. */
export async function divineSenseUses(
  characterId: string,
  userId: string,
): Promise<(PoolState & { row: CharacterFeature; featureId: string }) | null> {
  const character = await ownedCharacter(characterId, userId);
  if (!character || paladinLevelOf(character) <= 0) return null;
  const max = Math.max(1, 1 + (await charismaModifier(characterId)));
  const ensured = await ensurePoolRow(characterId, userId, DIVINE_SENSE_NAME, max);
  if (!ensured) return null;
  return { max, remaining: ensured.row.usesRemaining ?? max, row: ensured.row, featureId: ensured.featureId };
}

/**
 * Spend one Divine Sense use. Initializes the pool (1 + CHA mod, min 1) on first
 * use, then decrements through ClassFeatureUsageService so the sheet, the usage
 * log, and the long-rest restore all see the same row.
 */
export async function spendDivineSense(input: {
  characterId: string;
  userId: string;
  sessionId?: string;
  context?: string;
}): Promise<{ success: boolean; usesRemaining: number; message: string }> {
  const { characterId, userId, sessionId, context } = input;
  const pool = await divineSenseUses(characterId, userId);
  if (!pool) {
    return { success: false, usesRemaining: 0, message: 'Divine Sense is a paladin feature.' };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const result = await ClassFeatureUsageService.useFeature({    characterId,
    featureId: pool.featureId,
    userId,
    sessionId,
    context: context ?? 'divine-sense',
  });
  return {
    success: result.success,
    usesRemaining: result.usesRemaining,
    message: result.message,
  };
}

export type LayOnHandsResult =
  | {
      ok: true;
      healed: number;
      poolRemaining: number;
      poolMax: number;
      cured?: 'disease' | 'poison';
      message: string;
    }
  | {
      ok: false;
      reason: 'not_paladin' | 'empty_pool' | 'insufficient_pool';
      message: string;
      poolRemaining: number;
      poolMax: number;
    };

export interface ResolveLayOnHandsInput {
  characterId: string;
  userId: string;
  /** HP to draw from the pool. Defaults to the target's missing HP. */
  amount?: number;
  /** Defaults to the paladin themself. */
  targetCharacterId?: string;
  /** In combat: heal through the participant row (write-through to the sheet). */
  participantId?: string;
  encounterId?: string;
  /** Cure a disease or neutralize a poison instead of healing: costs 5 HP. */
  cure?: 'disease' | 'poison';
  sessionId?: string;
  context?: string;
}

async function missingHitPoints(
  targetCharacterId: string,
  participantId: string | undefined,
  encounterId: string | undefined,
): Promise<number> {
  if (participantId && encounterId) {
    const status = await CombatHPService.getParticipantStatus(participantId);
    if (status) return Math.max(0, (status.maxHp ?? 0) - (status.currentHp ?? 0));
  }
  const [stats] = await db
    .select({
      current: characterStats.currentHitPoints,
      max: characterStats.maxHitPoints,
    })
    .from(characterStats)
    .where(eq(characterStats.characterId, targetCharacterId))
    .limit(1);
  if (!stats) return 0;
  return Math.max(0, (stats.max ?? 0) - (stats.current ?? 0));
}

/**
 * Clear an active 'Poisoned' condition after Lay on Hands neutralizes it.
 * Best-effort: a missing library row or no active condition is not an error.
 */
async function clearPoisoned(input: {
  targetCharacterId: string;
  participantId?: string;
  encounterId?: string;
}): Promise<void> {
  const [library] = await db
    .select({ id: conditionsLibrary.id })
    .from(conditionsLibrary)
    .where(ilike(conditionsLibrary.name, 'poisoned'))
    .limit(1);
  if (!library) return;
  if (input.participantId) {
    await db
      .update(combatParticipantConditions)
      .set({ isActive: false })
      .where(
        and(
          eq(combatParticipantConditions.participantId, input.participantId),
          eq(combatParticipantConditions.conditionId, library.id),
          eq(combatParticipantConditions.isActive, true),
        ),
      );
    return;
  }
  await db
    .update(characterConditions)
    .set({ isActive: false })
    .where(
      and(
        eq(characterConditions.characterId, input.targetCharacterId),
        eq(characterConditions.conditionId, library.id),
        eq(characterConditions.isActive, true),
      ),
    );
}

/**
 * Resolve Lay on Hands against the pool: heal (or cure) the target, decrement
 * the pool, and refuse clearly when the pool cannot cover it. The pool row is
 * the single source of truth the sheet reads.
 */
export async function resolveLayOnHands(
  input: ResolveLayOnHandsInput,
): Promise<LayOnHandsResult> {
  const {
    characterId,
    userId,
    targetCharacterId,
    participantId,
    encounterId,
    cure,
    sessionId,
    context,
  } = input;
  const pool = await layOnHandsPool(characterId, userId);
  if (!pool) {
    return {
      ok: false,
      reason: 'not_paladin',
      message: 'Lay on Hands is a paladin feature.',
      poolRemaining: 0,
      poolMax: 0,
    };
  }
  const paladinName = pool.character.name || 'The paladin';
  const targetId = targetCharacterId ?? characterId;

  if (cure) {
    if (pool.remaining < LAY_ON_HANDS_CURE_COST) {
      return {
        ok: false,
        reason: 'insufficient_pool',
        message:
          `${paladinName}'s Lay on Hands pool has ${pool.remaining} of ${pool.max} HP left; ` +
          `curing ${cure === 'disease' ? 'a disease' : 'a poison'} costs ${LAY_ON_HANDS_CURE_COST}. ` +
          `They must finish a long rest to replenish it.`,
        poolRemaining: pool.remaining,
        poolMax: pool.max,
      };
    }
    const poolRemaining = pool.remaining - LAY_ON_HANDS_CURE_COST;
    await db
      .update(characterFeatures)
      .set({ usesRemaining: poolRemaining })
      .where(eq(characterFeatures.id, pool.row.id));
    // Disease has no condition row in the SRD list; a poisoned condition is cleared
    // best-effort so the sheet matches the narration.
    if (cure === 'poison') {
      await clearPoisoned({ targetCharacterId: targetId, participantId, encounterId });
    }
    await ClassFeatureUsageService.logFeatureUsage(
      characterId,
      pool.featureId,
      userId,
      context ?? `lay-on-hands-cure-${cure}`,
      sessionId,
    );
    return {
      ok: true,
      healed: 0,
      poolRemaining,
      poolMax: pool.max,
      cured: cure,
      message:
        `${paladinName} lays on hands and ` +
        (cure === 'disease' ? 'cures the disease' : 'neutralizes the poison') +
        `. Pool: ${poolRemaining} of ${pool.max} HP remaining.`,
    };
  }

  if (pool.remaining <= 0) {
    return {
      ok: false,
      reason: 'empty_pool',
      message:
        `${paladinName}'s Lay on Hands pool is empty (0 of ${pool.max} HP). ` +
        `They must finish a long rest to replenish it.`,
      poolRemaining: 0,
      poolMax: pool.max,
    };
  }

  const missing =
    typeof input.amount === 'number' && input.amount > 0
      ? Math.trunc(input.amount)
      : await missingHitPoints(targetId, participantId, encounterId);
  const draw = Math.min(Math.max(0, missing), pool.remaining);
  if (draw <= 0) {
    return {
      ok: true,
      healed: 0,
      poolRemaining: pool.remaining,
      poolMax: pool.max,
      message: `${paladinName}'s target is already at full health; the pool is untouched.`,
    };
  }

  if (participantId && encounterId) {
    await CombatHPService.healDamage(participantId, encounterId, draw, 'Lay on Hands', userId);
  } else {
    await CharacterVitalsService.heal(targetId, userId, draw);
  }

  const poolRemaining = pool.remaining - draw;
  await db
    .update(characterFeatures)
    .set({ usesRemaining: poolRemaining })
    .where(eq(characterFeatures.id, pool.row.id));
  await ClassFeatureUsageService.logFeatureUsage(
    characterId,
    pool.featureId,
    userId,
    context ?? 'lay-on-hands',
    sessionId,
  );

  const targetLabel = targetId === characterId ? 'themself' : 'their ally';
  return {
    ok: true,
    healed: draw,
    poolRemaining,
    poolMax: pool.max,
    message:
      `${paladinName} lays on hands and restores ${draw} HP to ${targetLabel}. ` +
      `Pool: ${poolRemaining} of ${pool.max} HP remaining.`,
  };
}

/**
 * Initialize the tracked pool for a feature the seed left with a NULL uses_count
 * (Divine Sense, Lay on Hands). Returns the pool's remaining value and its unit
 * label, or null when the feature is not a pooled paladin feature. Shared by
 * ClassFeatureUsageService.useFeature so the sheet's manual use button and the
 * turn path initialize the same row the same way.
 */
export async function ensureTrackedPool(
  characterId: string,
  featureId: string,
  userId: string,
): Promise<{ usesRemaining: number; unit: 'uses' | 'HP' } | null> {
  const [library] = await db
    .select({
      className: classFeaturesLibrary.className,
      featureName: classFeaturesLibrary.featureName,
    })
    .from(classFeaturesLibrary)
    .where(eq(classFeaturesLibrary.id, featureId))
    .limit(1);
  if (!library || library.className !== PALADIN_CLASS) return null;
  if (library.featureName === DIVINE_SENSE_NAME) {
    const pool = await divineSenseUses(characterId, userId);
    return pool ? { usesRemaining: pool.remaining, unit: 'uses' } : null;
  }
  if (library.featureName === LAY_ON_HANDS_NAME) {
    const pool = await layOnHandsPool(characterId, userId);
    return pool ? { usesRemaining: pool.remaining, unit: 'HP' } : null;
  }
  return null;
}

/** The unit a pooled feature's uses_remaining counts in, or null when unpooled. */
export function poolUnitLabel(featureName: string): 'uses' | 'HP' | null {
  if (featureName === LAY_ON_HANDS_NAME) return 'HP';
  if (featureName === DIVINE_SENSE_NAME) return 'uses';
  return null;
}

/**
 * Long-rest replenish for the two pooled paladin features. Called from
 * ClassFeatureUsageService.restoreFeatures: only rows already tracked (a
 * non-null uses_remaining) are reset, to their current maxima. Dynamic import
 * on the caller side avoids a module cycle.
 */
export async function replenishPaladinPools(
  characterId: string,
  userId: string,
): Promise<string[]> {
  const replenished: string[] = [];
  const loh = await layOnHandsPool(characterId, userId);
  if (loh && loh.row.usesRemaining !== null && loh.row.usesRemaining !== loh.max) {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: loh.max })
      .where(eq(characterFeatures.id, loh.row.id));
    replenished.push(LAY_ON_HANDS_NAME);
  }
  const sense = await divineSenseUses(characterId, userId);
  if (sense && sense.row.usesRemaining !== null && sense.row.usesRemaining !== sense.max) {
    await db
      .update(characterFeatures)
      .set({ usesRemaining: sense.max })
      .where(eq(characterFeatures.id, sense.row.id));
    replenished.push(DIVINE_SENSE_NAME);
  }
  return replenished;
}
