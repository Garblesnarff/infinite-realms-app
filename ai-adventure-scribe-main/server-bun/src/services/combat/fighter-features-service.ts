/**
 * #975: the Fighter's two short-rest features as engine resolutions.
 *
 * Second Wind and Action Surge already live on the sheet — a
 * `character_features` row granted from `class_features_library` (Second Wind
 * at level 1, Action Surge at level 2, one use per short rest, refreshed by
 * `ClassFeatureUsageService.restoreFeatures` on the rest path) — but the
 * combat-intent vocabulary had no word for either, so a typed declaration fell
 * through to "not supported yet" / "not a combat action" (Hark N21-021). This
 * module is the resolution the new `second_wind` / `action_surge` intents
 * dispatch to: spend the tracked use, then apply the effect through the same
 * writers the rest of the engine uses (CombatHPService for the heal, the
 * turn-resource claims for the extra action).
 *
 * The spend is a claim, like the Lay on Hands pool draw: one atomic decrement
 * that lands only while a use remains, so two resolutions in flight cannot
 * spend the same use twice. A spend whose effect then fails is released.
 *
 * @module server/services/combat/fighter-features-service
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { armActionSurge, readActionSurgeMark } from './combat-turn-resources.js';
import { db } from '../../../../db/client';
import {
  characterFeatures,
  characters,
  classFeaturesLibrary,
  combatParticipants,
  combatParticipantStatus,
} from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';
import { rollDie } from '../../lib/rng.js';
import { CombatHPService } from '../combat-hp-service.js';
import { ClassFeatureUsageService } from '../progression/class-feature-usage-service.js';

export const FIGHTER_CLASS = 'Fighter';
export const SECOND_WIND_NAME = 'Second Wind';
export const ACTION_SURGE_NAME = 'Action Surge';

/**
 * The legacy class-feature seed called the level-2 row "Action Surge" while
 * the generated SRD seed calls it "Action Surge (1 use)". Both rows describe
 * the same PHB feature; the engine must spend whichever canonical row the
 * database carries instead of treating the generated spelling as missing.
 */
const featureNameCandidates = (featureName: string): string[] =>
  featureName === ACTION_SURGE_NAME
    ? [
        featureName,
        `${featureName} (1 use)`,
        `${featureName} (2 uses)`,
        `${featureName} (two uses)`,
      ]
    : [featureName];

const canonicalFeatureName = (featureName: string): string =>
  featureName
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
    .toLowerCase();

type FeatureRowCandidate = {
  // Optional: the spend query selects the row id (its caller keys the
  // decrement to it); the display query does not select it. The
  // pickFeatureRow generic preserves whichever shape the caller passes.
  featureId?: string;
  usesRemaining: number | null;
  usesCount: number | null;
  levelAcquired: number;
  featureName: string;
};

/**
 * #1181 Required 1 — deterministic row choice. A character can hold more
 * than one row for the same canonical feature: the level-2 "Action Surge"
 * row and the level-17 "Action Surge (two uses)" row accumulate on a
 * level-17+ Fighter through the level-up grants, and the legacy and
 * generated spellings of one level's row can both be present. Matching by
 * canonical name with `limit(1)` and no ORDER BY spent whichever row the
 * database happened to return first, and the displayed count followed the
 * same arbitrary row. The row for the highest library level at or below
 * the character's fighter level wins (the L17 row at L17, the L2 row at
 * L2); rows tied on level break on the feature name. Exact duplicates —
 * two library rows with the same name and level — have no distinguishing
 * field (the library carries no unique constraint on name+level), so
 * that pre-existing case still resolves by return order. A character
 * holding only rows above their level — a grant that ran ahead of the
 * character's level — still spends a row deterministically (the lowest
 * held) instead of refusing a row the sheet carries. That fallback is
 * deliberate: gating here is grant-time only, and the old code spent
 * whatever its unordered match returned regardless of level.
 */
function pickFeatureRow<T extends FeatureRowCandidate>(rows: T[], fighterLevel: number): T | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort(
    (a, b) =>
      b.levelAcquired - a.levelAcquired ||
      (a.featureName < b.featureName ? -1 : a.featureName > b.featureName ? 1 : 0),
  );
  return ordered.find((row) => row.levelAcquired <= fighterLevel) ?? ordered[ordered.length - 1];
}

type CharacterRow = typeof characters.$inferSelect;

/** Fighter levels: `classLevels` entries ({ className, level }) win; else class/level. */
export function fighterLevelOf(character: {
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
      (entry as { className: string }).className.toLowerCase() === 'fighter'
    ) {
      const entryLevel = (entry as { level?: unknown }).level;
      multiclass += typeof entryLevel === 'number' && entryLevel > 0 ? Math.trunc(entryLevel) : 0;
    }
  }
  if (multiclass > 0) return multiclass;
  return (character.class ?? '').toLowerCase() === 'fighter' ? (character.level ?? 0) : 0;
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

/**
 * The tracked uses of the Fighter's short-rest features, for the legal-action
 * list; when the sheet carries more than one row for a feature, the row for
 * the highest library level at or below the character's fighter level wins
 * (see `pickFeatureRow`). `null` means the sheet carries no row for the feature at all; a row
 * granted before uses were tracked reads as its library count, which is what
 * the spend below treats it as.
 */
export async function fighterFeatureUses(
  characterId: string,
): Promise<{ secondWind: number | null; actionSurge: number | null }> {
  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  const fighterLevel = character ? fighterLevelOf(character) : 0;
  const rows = await db
    .select({
      featureName: classFeaturesLibrary.featureName,
      usesRemaining: characterFeatures.usesRemaining,
      usesCount: classFeaturesLibrary.usesCount,
      levelAcquired: classFeaturesLibrary.levelAcquired,
    })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(classFeaturesLibrary.className, FIGHTER_CLASS),
      ),
    );
  const remainingOf = (featureName: string): number | null => {
    const row = pickFeatureRow(
      rows.filter(
        (candidate) =>
          canonicalFeatureName(candidate.featureName) === canonicalFeatureName(featureName),
      ),
      fighterLevel,
    );
    if (!row) return null;
    return row.usesRemaining ?? row.usesCount;
  };
  return {
    secondWind: remainingOf(SECOND_WIND_NAME),
    actionSurge: remainingOf(ACTION_SURGE_NAME),
  };
}

/**
 * Spend one tracked use of a Fighter feature, atomically. Refusals are
 * BusinessLogicErrors with player-comprehensible messages: no row on the
 * sheet, or no uses left before a short rest.
 */
async function spendFighterFeatureUse(input: {
  characterId: string;
  userId: string;
  featureName: string;
  sessionId?: string;
  context: string;
}): Promise<{ usesRemaining: number; featureId: string; usesCount: number | null }> {
  const { characterId, userId, featureName, sessionId, context } = input;
  // The character's fighter level decides which row the spend hits (#1181):
  // the L17 "Action Surge (two uses)" row, not the L2 row, at L17+. The
  // ownership check doubles as the missing/unowned refusal, keeping the
  // same error this path threw before the row choice existed.
  const character = await ownedCharacter(characterId, userId);
  if (!character) {
    throw new BusinessLogicError(`${featureName} is not on this character's sheet`, {
      reason: 'feature_not_on_sheet',
      featureName,
    });
  }
  const fighterLevel = fighterLevelOf(character);
  const candidates = await db
    .select({
      characterFeatureId: characterFeatures.id,
      featureId: characterFeatures.featureId,
      usesRemaining: characterFeatures.usesRemaining,
      usesCount: classFeaturesLibrary.usesCount,
      levelAcquired: classFeaturesLibrary.levelAcquired,
      featureName: classFeaturesLibrary.featureName,
    })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(classFeaturesLibrary.className, FIGHTER_CLASS),
        inArray(classFeaturesLibrary.featureName, featureNameCandidates(featureName)),
      ),
    );
  const row = pickFeatureRow(candidates, fighterLevel);

  if (!row) {
    throw new BusinessLogicError(`${featureName} is not on this character's sheet`, {
      reason: 'feature_not_on_sheet',
      featureName,
    });
  }

  // A row with no count anywhere is an untracked, unlimited feature (the
  // ClassFeatureUsageService rule); the two Fighter features are seeded with
  // a count, so this is only a guard against a future library edit.
  if (row.usesCount === null && row.usesRemaining === null) {
    await ClassFeatureUsageService.logFeatureUsage(
      characterId,
      row.featureId,
      userId,
      context,
      sessionId,
    );
    return { usesRemaining: -1, featureId: row.featureId, usesCount: null };
  }

  // The claim: decrement lands only while a use remains. COALESCE treats a
  // row granted before uses were tracked (NULL remaining) as its full count,
  // the same reading the legal-action list gives it.
  const [updated] = await db
    .update(characterFeatures)
    .set({
      usesRemaining: sql`COALESCE(${characterFeatures.usesRemaining}, ${row.usesCount}) - 1`,
    })
    .where(
      and(
        eq(characterFeatures.id, row.characterFeatureId),
        sql`COALESCE(${characterFeatures.usesRemaining}, ${row.usesCount}) > 0`,
      ),
    )
    .returning({ usesRemaining: characterFeatures.usesRemaining });
  if (!updated) {
    throw new BusinessLogicError(
      `${featureName} has no uses remaining — it refreshes on a short rest`,
      { reason: 'feature_uses_exhausted', featureName },
    );
  }

  // The usage log is bookkeeping, but it can throw (its own ownership lookup)
  // after the decrement has landed — and a use burned on bookkeeping, with the
  // resolver's compensation not yet in scope, is a feature silently eaten.
  // The spend compensates itself: log failure releases the claim.
  try {
    await ClassFeatureUsageService.logFeatureUsage(
      characterId,
      row.featureId,
      userId,
      context,
      sessionId,
    );
  } catch (error) {
    await releaseFighterFeatureUse(characterId, row.featureId, row.usesCount);
    throw error;
  }
  return {
    usesRemaining: updated.usesRemaining ?? 0,
    featureId: row.featureId,
    usesCount: row.usesCount,
  };
}

/**
 * Give a claimed use back when the effect it paid for failed to land. Clamped
 * at the library count: a rest landing between spend and release resets the
 * row to full, and an unclamped increment would mint a phantom use.
 */
async function releaseFighterFeatureUse(
  characterId: string,
  featureId: string,
  usesCount: number | null,
): Promise<void> {
  await db
    .update(characterFeatures)
    .set({
      usesRemaining:
        usesCount === null
          ? sql`COALESCE(${characterFeatures.usesRemaining}, 0) + 1`
          : sql`LEAST(COALESCE(${characterFeatures.usesRemaining}, 0) + 1, ${usesCount})`,
    })
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
      ),
    );
}

export interface SecondWindResult {
  applied: true;
  action: 'second_wind';
  /** The d10 the engine rolled, before the fighter-level bonus. */
  roll: number;
  healed: number;
  newHp: number;
  maxHp: number;
  usesRemaining: number;
}

/**
 * Second Wind: a bonus action that regains 1d10 + fighter level hit points.
 * The bonus-action claim itself is the caller's (`claimTurnBonusActionAndResolve`
 * in the dispatch, which refunds the claim when this throws); this spends the
 * feature use and applies the heal through CombatHPService, so the sheet's HP
 * moves with the participant's.
 */
export async function resolveSecondWind(input: {
  characterId: string;
  userId: string;
  participantId: string;
  encounterId: string;
  sessionId?: string;
}): Promise<SecondWindResult> {
  const { characterId, userId, participantId, encounterId, sessionId } = input;
  const character = await ownedCharacter(characterId, userId);
  const level = character ? fighterLevelOf(character) : 0;
  if (!character || level <= 0) {
    throw new BusinessLogicError(`${SECOND_WIND_NAME} is not on this character's sheet`, {
      reason: 'feature_not_on_sheet',
      featureName: SECOND_WIND_NAME,
    });
  }

  const [status] = await db
    .select({ currentHp: combatParticipantStatus.currentHp, maxHp: combatParticipantStatus.maxHp })
    .from(combatParticipantStatus)
    .where(eq(combatParticipantStatus.participantId, participantId))
    .limit(1);
  if (!status) {
    throw new BusinessLogicError('Combat participant not found', { participantId });
  }
  // Refused before anything is spent: a Second Wind at full health would burn
  // the use and the bonus action on zero healing.
  if (status.currentHp >= status.maxHp) {
    throw new BusinessLogicError(`${character.name || 'The fighter'} is already at full health`, {
      reason: 'already_full_health',
      featureName: SECOND_WIND_NAME,
    });
  }

  const spend = await spendFighterFeatureUse({
    characterId,
    userId,
    featureName: SECOND_WIND_NAME,
    sessionId,
    context: 'combat-second-wind',
  });

  const roll = rollDie(10);
  try {
    const result = await CombatHPService.healDamage(
      participantId,
      encounterId,
      roll + level,
      SECOND_WIND_NAME,
      userId,
    );
    return {
      applied: true,
      action: 'second_wind',
      roll,
      // The heal's own accounting of what it applied (already capped), not a
      // diff against the pre-spend snapshot — the two can disagree if anything
      // else writes the participant's HP in between.
      healed: result.healingApplied,
      newHp: result.newCurrentHp,
      maxHp: status.maxHp,
      usesRemaining: spend.usesRemaining,
    };
  } catch (error) {
    await releaseFighterFeatureUse(characterId, spend.featureId, spend.usesCount);
    throw error;
  }
}

export interface ActionSurgeResult {
  applied: true;
  action: 'action_surge';
  usesRemaining: number;
  /**
   * True when the action was still unspent and the extra action is armed for
   * the claim that follows it; false when a spent action was refunded on the
   * spot, which is the same grant already in hand.
   */
  extraActionArmed: boolean;
}

/**
 * Action Surge: one additional action on this turn, once per short rest. If
 * the fighter already spent their action, the surge refunds it. If they have
 * not, the surge is armed (see `armActionSurge`) and the turn's next action
 * claim spends the arm instead of refusing — either way exactly one extra
 * action, and the turn does not end.
 */
export async function resolveActionSurge(input: {
  characterId: string;
  userId: string;
  participantId: string;
  encounterId: string;
  sessionId: string;
  round: number;
  actionUsed: boolean;
}): Promise<ActionSurgeResult> {
  const { characterId, userId, participantId, encounterId, sessionId, round, actionUsed } = input;
  // The mark is a single slot. Arming a second surge over a live one would
  // spend the use on an identical mark — refuse before anything is spent.
  // (With the action already spent the refund path below applies instead,
  // and the live mark still pays for the action after it.)
  if (!actionUsed) {
    const armed = await readActionSurgeMark(sessionId);
    if (
      armed &&
      armed.encounterId === encounterId &&
      armed.participantId === participantId &&
      armed.round === round
    ) {
      throw new BusinessLogicError('Action Surge is already armed for this turn', {
        reason: 'action_surge_already_armed',
        featureName: ACTION_SURGE_NAME,
      });
    }
  }
  const spend = await spendFighterFeatureUse({
    characterId,
    userId,
    featureName: ACTION_SURGE_NAME,
    sessionId,
    context: 'combat-action-surge',
  });

  try {
    if (actionUsed) {
      const [refunded] = await db
        .update(combatParticipants)
        .set({ actionUsed: false, updatedAt: new Date() })
        .where(
          and(
            eq(combatParticipants.id, participantId),
            eq(combatParticipants.encounterId, encounterId),
          ),
        )
        .returning({ id: combatParticipants.id });
      // No row back means nothing was refunded — reporting success here would
      // spend the use, record the DM fact, and grant no action at all.
      if (!refunded) {
        throw new BusinessLogicError('Combat participant not found', { participantId });
      }
      return {
        applied: true,
        action: 'action_surge',
        usesRemaining: spend.usesRemaining,
        extraActionArmed: false,
      };
    }
    await armActionSurge(sessionId, { encounterId, participantId, round });
    return {
      applied: true,
      action: 'action_surge',
      usesRemaining: spend.usesRemaining,
      extraActionArmed: true,
    };
  } catch (error) {
    await releaseFighterFeatureUse(characterId, spend.featureId, spend.usesCount);
    throw error;
  }
}
