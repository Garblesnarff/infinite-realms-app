/**
 * Class Feature Usage Service
 *
 * Handles tracking, logging, and restoration of D&D 5E class feature uses.
 * Extracted from ClassFeaturesService to modularize usage mechanics.
 *
 * @module server/services/progression/class-feature-usage-service
 */

import { eq, and, desc, sql, exists, or } from 'drizzle-orm';

import {
  countedGrantPreview,
  engineRefilledRowIds,
  grantCountedFeatureUses,
  refillCountedFeatures,
  spendCountedFeatureUse,
} from './limited-feature-uses.js';
import { db } from '../../../../db/client';
import {
  characterFeatures,
  characterStats,
  featureUsageLog,
  characters,
  classFeaturesLibrary,
  type CharacterFeature,
  type FeatureUsageLog,
} from '../../../../db/schema/index';
import {
  divineSmiteDice,
  divineSmiteLine,
  familyCountRule,
  limitedFeatureRule,
  variableSpendRoute,
  type VariableSpendRoute,
} from '../../../../shared/limited-feature-counts';
import {
  BusinessLogicError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type {
  UseFeatureInput,
  UseFeatureResult,
  RestoreFeaturesInput,
  RestoreFeaturesResult,
  CharacterFeaturesWithUsage,
  FeatureUsageHistoryParams,
} from '../../types/class-features.js';

/** CHA for Bardic Inspiration, WIS for War Priest. Other features are not gated (#1232). */
function abilityScoreForFeature(featureName: string): 'charisma' | 'wisdom' | null {
  if (featureName === 'Bardic Inspiration' || featureName.startsWith('Bardic Inspiration ')) {
    return 'charisma';
  }
  if (featureName === 'War Priest') return 'wisdom';
  return null;
}

/**
 * A Divine Intervention spend is a success unless the caller records a failure.
 * The long-rest refill reads these tokens (#1232).
 */
function divineInterventionContext(
  featureName: string,
  context: string | null | undefined,
): string | undefined {
  if (featureName !== 'Divine Intervention') return context ?? undefined;
  if ((context ?? '').includes('divine-intervention:failure')) return context ?? undefined;
  return `${context ?? ''} divine-intervention:success`.trim();
}

/**
 * Class Feature Usage Service
 */
export class ClassFeatureUsageService {
  /**
   * Verify user owns the character.
   * Throws NOT_FOUND to avoid disclosing character existence.
   */
  private static async verifyCharacterOwnership(
    characterId: string,
    userId: string,
  ): Promise<void> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
      columns: { id: true },
    });

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }
  }

  /**
   * Get feature usage information for a character
   */
  static async getFeatureUsage(
    characterId: string,
    featureId: string,
    userId: string,
  ): Promise<number | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [characterFeature] = await (db as any)
      .select({
        usesRemaining: characterFeatures.usesRemaining,
      })
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

    if (!characterFeature) {
      throw new NotFoundError('Feature for character', characterId);
    }

    return characterFeature.usesRemaining;
  }

  /**
   * Spend one use of a limited-use feature
   */
  static async spendFeatureUse(
    input: UseFeatureInput & { userId: string },
  ): Promise<UseFeatureResult> {
    const { characterId, featureId, context, sessionId, userId } = input;

    // Get character feature with ownership check
    const characterFeature = await db.query.characterFeatures.findFirst({
      where: and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, featureId),
        exists(
          db
            .select()
            .from(characters)
            .where(
              and(
                eq(characters.id, characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
              ),
            ),
        ),
      ),
      with: {
        feature: true,
      },
    });

    if (!characterFeature) {
      return {
        success: false,
        usesRemaining: 0,
        effect: '',
        message: 'Feature not found for this character',
      };
    }

    const feature = characterFeature.feature!;

    // Bardic Inspiration (CHA) and War Priest (WIS) have no count without a
    // stored ability score (#1232). A missing characterStats row is that case:
    // the columns themselves are NOT NULL. Refuse instead of treating the
    // feature as unlimited.
    const gatedAbility = abilityScoreForFeature(feature.featureName);
    if (gatedAbility) {
      const [stats] = await db
        .select({
          charisma: characterStats.charisma,
          wisdom: characterStats.wisdom,
        })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId))
        .limit(1);
      const score = stats?.[gatedAbility];
      if (typeof score !== 'number') {
        // Refused, and no stats row is written: a row written here would carry the schema
        // defaults for HP and AC too (#1232). Rows that are missing are legacy data; the
        // backfill that writes them is a separate, approved change.
        logger.warn({
          msg: 'ABILITY_FEATURE_STATS_ROW_MISSING',
          characterId,
          feature: feature.featureName,
        });
        return {
          success: false,
          usesRemaining: 0,
          effect: '',
          message: `${feature.featureName} is not spent: its uses depend on an ability score this character has none of. Set the character's ability scores to spend it.`,
        };
      }
    }

    const usageContext = divineInterventionContext(feature.featureName, context);

    // #1225: a limited feature is spent by the engine's count (shared/limited-feature-counts.ts),
    // never by "the library has no count, so it is unlimited". A feature that spends another
    // resource is classified by that resource, not by its rest tag: it draws its cost from the
    // counted family (Turn Undead from Channel Divinity, Flurry of Blows from ki), or, when the
    // cost cannot be routed, is refused with that reason. A limited feature the engine cannot
    // count is refused below (fail closed). #1233: a route-less spend whose cost varies with
    // the use (Divine Smite's slot level, a Metamagic option, a Flexible Casting direction)
    // resolves from the request's slotLevel / option; a missing or invalid input refuses
    // with the reason, and the bare refusal below stays for any other route-less spend.
    const rule = limitedFeatureRule(feature.className, feature.featureName);
    const limited = feature.usesPerRest === 'short_rest' || feature.usesPerRest === 'long_rest';
    if (rule?.kind === 'spends') {
      if (!rule.route) {
        // #1233: only a request carrying a variable input resolves the variable
        // route. A bare use falls through to the generic refusal below, unchanged
        // (an existing test asserts its exact message).
        if (input.slotLevel !== undefined || input.option !== undefined) {
          const variable = variableSpendRoute(feature.className, feature.featureName, {
            slotLevel: input.slotLevel,
            option: input.option,
          });
          if (variable) {
            return this.spendVariableCost({
              characterId,
              featureId,
              feature,
              pool: rule.pool,
              context,
              sessionId,
              userId,
              variable,
            });
          }
        }
      }
      const poolRule = rule.route ? familyCountRule(rule.route.family) : null;
      if (!rule.route || !poolRule) {
        return {
          success: false,
          usesRemaining: 0,
          effect: '',
          message: `${feature.featureName} has no uses of its own: it spends ${rule.pool}, so it was not spent here.`,
        };
      }
      const spent = await spendCountedFeatureUse({
        characterId,
        userId,
        className: feature.className,
        featureName: rule.pool,
        rule: poolRule,
        spentBy: { featureName: feature.featureName, cost: rule.route.cost },
      });
      if (!spent.ok) {
        return { success: false, usesRemaining: 0, effect: '', message: spent.reason };
      }
      await this.logFeatureUsage(characterId, featureId, userId, usageContext, sessionId);
      return {
        success: true,
        usesRemaining: spent.usesRemaining,
        effect: feature.mechanicalEffects || feature.description,
        message:
          spent.usesRemaining < 0
            ? `${feature.featureName} activated`
            : `${feature.featureName} used. ${spent.usesRemaining} ${rule.pool} remaining.`,
      };
    }
    if (rule?.kind === 'count') {
      const spent = await spendCountedFeatureUse({
        characterId,
        userId,
        className: feature.className,
        featureName: feature.featureName,
        rule,
      });
      if (!spent.ok) {
        return { success: false, usesRemaining: 0, effect: '', message: spent.reason };
      }
      await this.logFeatureUsage(characterId, spent.featureId, userId, usageContext, sessionId);
      return {
        success: true,
        usesRemaining: spent.usesRemaining,
        effect: feature.mechanicalEffects || feature.description,
        message:
          spent.usesRemaining < 0
            ? `${feature.featureName} activated`
            : `${feature.featureName} used. ${spent.usesRemaining} uses remaining.`,
      };
    }

    // A NULL uses_count with an explicitly tracked uses_remaining is a pool, not an
    // unlimited feature (#712: Divine Sense tracks 1 + CHA mod, Lay on Hands tracks
    // paladin level x 5 HP). Only a row with no remaining value at all is unlimited:
    // a NULL uses_count with no tracking is never given an invented count (#224).
    if (feature.usesCount === null && characterFeature.usesRemaining === null) {
      // Dynamic import: paladin-features-service calls back into this service, so a
      // static import would be a module cycle (same pattern as dm-feature-gate).
      const { ensureTrackedPool } = await import('./paladin-features-service.js');
      const ensured = await ensureTrackedPool(characterId, feature.id, userId);
      if (ensured) {
        characterFeature.usesRemaining = ensured.usesRemaining;
      } else if (limited && rule?.kind !== 'not_counted') {
        // #1225: limited by the PHB (the seed gives it a rest), but the engine has no count for
        // it: refuse rather than mint unlimited uses.
        logger.warn({
          msg: 'CLASS_FEATURE_UNCOUNTED_LIMITED_REFUSED',
          characterId,
          featureId,
          className: feature.className,
          featureName: feature.featureName,
        });
        return {
          success: false,
          usesRemaining: 0,
          effect: '',
          message: `${feature.featureName} is limited, and the engine cannot count its uses yet, so it was not spent.`,
        };
      } else {
        await this.logFeatureUsage(characterId, featureId, userId, usageContext, sessionId);

        return {
          success: true,
          usesRemaining: -1, // -1 indicates unlimited
          effect: feature.mechanicalEffects || feature.description,
          message: `${feature.featureName} activated`,
        };
      }
    }

    const [spent] = await db
      .update(characterFeatures)
      .set({ usesRemaining: sql`${characterFeatures.usesRemaining} - 1` })
      .where(
        and(
          eq(characterFeatures.id, characterFeature.id),
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
          sql`${characterFeatures.usesRemaining} >= 1`,
          exists(
            db
              .select()
              .from(characters)
              .where(
                and(
                  eq(characters.id, characterId),
                  or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
                ),
              ),
          ),
        ),
      )
      .returning({ usesRemaining: characterFeatures.usesRemaining });

    if (!spent) {
      return {
        success: false,
        usesRemaining: 0,
        effect: '',
        message: `No uses remaining for ${feature.featureName}`,
      };
    }
    const newUsesRemaining = spent.usesRemaining!;

    // Log the usage
    await this.logFeatureUsage(characterId, featureId, userId, usageContext, sessionId);

    // #712: a pooled feature (Lay on Hands) counts HP, not uses.
    const { poolUnitLabel } = await import('./paladin-features-service.js');
    const unit = poolUnitLabel(feature.featureName);
    return {
      success: true,
      usesRemaining: newUsesRemaining,
      effect: feature.mechanicalEffects || feature.description,
      message:
        unit === 'HP'
          ? `${feature.featureName} used. ${newUsesRemaining} HP remaining in the pool.`
          : `${feature.featureName} used. ${newUsesRemaining} uses remaining.`,
    };
  }

  /**
   * #1233: spend a variable-cost feature from the route the use request resolved to.
   * Spend-first ordering: the cost lands before any grant, so a refusal (no slots, no
   * points) has no side effects. The convert path previews the grant before spending
   * the slot, so a refusal never follows an irreversible spend. A Smite posts its
   * engine line only after the spend, best-effort: a session that cannot take the
   * line must not lose the spend.
   */
  private static async spendVariableCost(input: {
    characterId: string;
    featureId: string;
    feature: {
      className: string;
      featureName: string;
      description: string;
      mechanicalEffects: string | null;
    };
    pool: string;
    context?: string;
    sessionId?: string;
    userId: string;
    variable: VariableSpendRoute;
  }): Promise<UseFeatureResult> {
    const { characterId, featureId, feature, pool, context, sessionId, userId, variable } = input;
    const refused = (message: string): UseFeatureResult => ({
      success: false,
      usesRemaining: 0,
      effect: '',
      message,
    });
    if (variable.kind === 'refuse') return refused(variable.reason);

    const { SpellSlotsService } = await import('../spell-slots-service.js');
    if (variable.kind === 'slot') {
      // Divine Smite: spend the named slot through the slots service (the single source
      // of slot state), and name its refusal instead of a generic one.
      let spent;
      try {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- server-side class method, not a React hook
        spent = await SpellSlotsService.useSpellSlot(
          {
            characterId,
            spellName: feature.featureName,
            spellLevel: 1,
            slotLevelUsed: variable.slotLevel,
            sessionId,
          },
          userId,
        );
      } catch (error) {
        if (error instanceof BusinessLogicError || error instanceof ValidationError) {
          return refused(error.message);
        }
        throw error;
      }
      await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);
      const line = divineSmiteLine(variable.slotLevel);
      if (sessionId) {
        try {
          // Dynamic import: the engine-chat line module is loaded only on the Smite path.
          const { postEngineChatLine } = await import('../engine-chat-line.js');
          await postEngineChatLine({
            sessionId,
            userId,
            idSeed: `divine-smite:${sessionId}:${characterId}:${spent.logEntry.id}`,
            text: line,
            context: {
              kind: 'divine_smite',
              slotLevel: variable.slotLevel,
              damageDice: `${divineSmiteDice(variable.slotLevel)}d8`,
            },
          });
        } catch (lineError) {
          logger.warn({
            msg: 'DIVINE_SMITE_ENGINE_ROW_FAILED',
            characterId,
            featureId,
            error: lineError,
          });
        }
      }
      return {
        success: true,
        usesRemaining: spent.slot.remainingSlots,
        effect: line,
        message: `${feature.featureName} used a level ${variable.slotLevel} spell slot. ${line}`,
      };
    }

    if (variable.kind === 'convertSlot') {
      // Flexible Casting, converting: establish that the grant can land BEFORE the
      // irreversible slot spend, so a refusal never follows a spent slot. The grant
      // re-checks when it writes; a failure there means the row vanished mid-flight,
      // which is a 500, never a refusal after the spend.
      const poolRule = familyCountRule('sorcerer-sorcery-points');
      if (!poolRule)
        return refused(`${feature.featureName} spends ${pool}, so it was not spent here.`);
      const preview = await countedGrantPreview({
        characterId,
        userId,
        className: feature.className,
        featureName: 'Font of Magic',
        rule: poolRule,
        grantedBy: { featureName: feature.featureName, amount: variable.slotLevel },
      });
      if (!preview.ok) return refused(preview.reason);
      try {
        // eslint-disable-next-line react-hooks/rules-of-hooks -- server-side class method, not a React hook
        await SpellSlotsService.useSpellSlot(
          {
            characterId,
            spellName: feature.featureName,
            spellLevel: 0,
            slotLevelUsed: variable.slotLevel,
            sessionId,
          },
          userId,
        );
      } catch (error) {
        if (error instanceof BusinessLogicError || error instanceof ValidationError) {
          return refused(error.message);
        }
        throw error;
      }
      const granted = await grantCountedFeatureUses({
        characterId,
        userId,
        className: feature.className,
        featureName: 'Font of Magic',
        rule: poolRule,
        grantedBy: { featureName: feature.featureName, amount: variable.slotLevel },
      });
      if (!granted.ok) {
        logger.error({
          msg: 'FLEXIBLE_CASTING_GRANT_FAILED_AFTER_SPEND',
          characterId,
          featureId,
          reason: granted.reason,
        });
        throw new InternalServerError(
          'Failed to grant sorcery points after converting a spell slot',
        );
      }
      await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);
      return {
        success: true,
        usesRemaining: granted.usesRemaining,
        effect: feature.mechanicalEffects || feature.description,
        message: `${feature.featureName} used. Converted a level ${variable.slotLevel} spell slot into ${variable.slotLevel} sorcery point${variable.slotLevel === 1 ? '' : 's'}. ${granted.usesRemaining} sorcery points remaining.`,
      };
    }

    // Metamagic ('points') and Flexible Casting creating a slot ('createSlot'): both draw
    // sorcery points from the Font of Magic family; creating then grants the slot.
    const poolRule = familyCountRule(variable.family);
    if (!poolRule) {
      return refused(
        `${feature.featureName} has no uses of its own: it spends ${pool}, so it was not spent here.`,
      );
    }
    const spent = await spendCountedFeatureUse({
      characterId,
      userId,
      className: feature.className,
      featureName: 'Font of Magic',
      rule: poolRule,
      spentBy: { featureName: feature.featureName, cost: variable.cost },
    });
    if (!spent.ok) return refused(spent.reason);
    if (variable.kind === 'createSlot') {
      const granted = await SpellSlotsService.grantSpellSlot(
        characterId,
        variable.slotLevel,
        userId,
      );
      await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);
      return {
        success: true,
        usesRemaining: spent.usesRemaining,
        effect: feature.mechanicalEffects || feature.description,
        message: `${feature.featureName} used. A level ${variable.slotLevel} spell slot was created (${granted.totalSlots} total). ${spent.usesRemaining} sorcery points remaining.`,
      };
    }
    await this.logFeatureUsage(characterId, featureId, userId, context, sessionId);
    return {
      success: true,
      usesRemaining: spent.usesRemaining,
      effect: feature.mechanicalEffects || feature.description,
      message: `${feature.featureName} used (${variable.label}). ${spent.usesRemaining} ${pool} remaining.`,
    };
  }

  /**
   * Restore features after rest
   */
  static async restoreFeatures(
    input: RestoreFeaturesInput & { userId: string },
  ): Promise<RestoreFeaturesResult> {
    const { characterId, restType, userId } = input;

    // #1225: rows the engine counts are refilled by its table's rest rule below, not by their
    // stored tag here. A failed lookup is logged and the restore goes on by the stored tags,
    // never a failed rest (the same pattern as the refills below).
    let engineRows: string[] = [];
    try {
      engineRows = await engineRefilledRowIds(characterId);
    } catch (error) {
      logger.warn({ msg: 'COUNTED_FEATURE_ROWS_LOOKUP_FAILED', characterId, error });
    }
    const skipEngineRows =
      engineRows.length > 0
        ? sql`AND cf.id NOT IN (${sql.join(
            engineRows.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql``;

    // Get all character features with ownership check
    // ⚡ Bolt: Optimized N+1 update loop into a single atomic UPDATE ... FROM query.
    // This reduces database round-trips from O(N) (number of character features) to O(1).
    // 🛡️ Sentinel: Incorporate ownership check into the batch UPDATE query for defense-in-depth.
    const restoredRows = await db.execute<{ feature_name: string }>(sql`
      UPDATE ${characterFeatures} cf
      SET uses_remaining = cfl.uses_count
      FROM ${classFeaturesLibrary} cfl
      WHERE cf.feature_id = cfl.id
        AND cf.character_id = ${characterId}
        AND cfl.uses_count IS NOT NULL
        ${skipEngineRows}
        AND (
          (${restType} = 'short' AND cfl.uses_per_rest = 'short_rest')
          OR
          (${restType} = 'long' AND (cfl.uses_per_rest = 'short_rest' OR cfl.uses_per_rest = 'long_rest'))
        )
        -- Divine Intervention stays spent for 7 days after a success (#1232).
        -- A later logged failure is the failed attempt, and a long rest may refill it.
        AND NOT (
          ${restType} = 'long'
          AND cfl.feature_name = 'Divine Intervention'
          AND EXISTS (
            SELECT 1 FROM ${featureUsageLog} ful
            WHERE ful.character_id = cf.character_id
              AND ful.feature_id = cf.feature_id
              AND ful.context LIKE '%divine-intervention:success%'
              AND ful.used_at > NOW() - INTERVAL '7 days'
              AND NOT EXISTS (
                SELECT 1 FROM ${featureUsageLog} later
                WHERE later.character_id = ful.character_id
                  AND later.feature_id = ful.feature_id
                  AND later.used_at > ful.used_at
                  AND later.context LIKE '%divine-intervention:failure%'
              )
          )
        )
        AND EXISTS (
          SELECT 1 FROM ${characters} c
          WHERE c.id = cf.character_id
          AND (c.user_id = ${userId} OR c.owner_id = ${userId})
        )
      RETURNING cfl.feature_name
    `);

    const featuresRestored = restoredRows.map((row) => row.feature_name);

    // #1187: Action Surge is one library row with a level-keyed count (2 at fighter level
    // 17), so the library `uses_count` written above is not its full count. Dynamic import:
    // fighter-features-service imports this service. A failed refill is logged, never a
    // failed rest.
    try {
      const { refillActionSurgeUses } = await import('../combat/fighter-features-service.js');
      await refillActionSurgeUses(characterId, userId);
    } catch (error) {
      logger.warn({ msg: 'ACTION_SURGE_REFILL_FAILED', characterId, error });
    }

    // #975: a Fighter's Second Wind from the generated SRD seed has a NULL uses_count, so the
    // SQL above skips it. Same dynamic import and log-and-continue pattern as above.
    try {
      const { refillSecondWindUses } = await import('../combat/fighter-features-service.js');
      featuresRestored.push(...(await refillSecondWindUses(characterId, userId)));
    } catch (error) {
      logger.warn({ msg: 'SECOND_WIND_REFILL_FAILED', characterId, error });
    }

    // #1225: features the engine counts by level or ability (Rage, Ki, Channel Divinity...)
    // carry a NULL or per-tier library count; their canonical row is refilled to the engine's
    // count here. A failed refill is logged, never a failed rest.
    try {
      featuresRestored.push(...(await refillCountedFeatures(characterId, userId, restType)));
    } catch (error) {
      logger.warn({ msg: 'COUNTED_FEATURE_REFILL_FAILED', characterId, error });
    }

    // #712: Divine Sense (1 + CHA mod) and Lay on Hands (paladin level x 5) are
    // seeded with a NULL uses_count, so the SQL above skips them; their pools live
    // in uses_remaining and are replenished here on a long rest. A failed reset is
    // logged, never a failed rest.
    if (restType === 'long') {
      try {
        const { replenishPaladinPools } = await import('./paladin-features-service.js');
        featuresRestored.push(...(await replenishPaladinPools(characterId, userId)));
      } catch (error) {
        logger.warn({ msg: 'PALADIN_POOL_REPLENISH_FAILED', characterId, error });
      }
    }

    return {
      featuresRestored,
      restoredCount: featuresRestored.length,
    };
  }

  /**
   * Log feature usage
   */
  static async logFeatureUsage(
    characterId: string,
    featureId: string,
    userId: string,
    context?: string,
    sessionId?: string,
  ): Promise<FeatureUsageLog> {
    // Verify ownership before logging
    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.id, characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      )
      .limit(1);

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }

    // The insert-select repeated the ownership query immediately above it, and its
    // projection covered 4 of feature_usage_log's 7 columns, so Drizzle threw and no
    // feature use was ever logged. The check above is the authorization.
    const [log] = await db
      .insert(featureUsageLog)
      .values({
        characterId,
        featureId,
        sessionId: sessionId || null,
        context: context || null,
      })
      .returning();

    if (!log) {
      throw new NotFoundError('Character', characterId);
    }

    return log;
  }

  /**
   * Get feature usage history
   */
  static async getFeatureUsageHistory(
    params: FeatureUsageHistoryParams & { userId: string },
  ): Promise<FeatureUsageLog[]> {
    const { characterId, featureId, sessionId, limit = 50, userId } = params;

    const conditions = [
      eq(featureUsageLog.characterId, characterId),
      exists(
        db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      ),
    ];

    if (featureId) {
      conditions.push(eq(featureUsageLog.featureId, featureId));
    }

    if (sessionId) {
      conditions.push(eq(featureUsageLog.sessionId, sessionId));
    }

    const history = await db.query.featureUsageLog.findMany({
      where: conditions.length > 1 ? and(...conditions) : conditions[0],
      with: {
        feature: true,
      },
      orderBy: [desc(featureUsageLog.usedAt)],
      limit,
    });

    return history;
  }

  /**
   * Get character features with usage information
   */
  static async getCharacterFeaturesWithUsage(
    characterId: string,
    userId: string,
    getCharacterFeatures: (characterId: string, userId: string) => Promise<CharacterFeature[]>,
  ): Promise<CharacterFeaturesWithUsage> {
    const features = await getCharacterFeatures(characterId, userId);

    const usesRemaining: Record<string, number> = {};

    for (const feature of features) {
      if (feature.usesRemaining !== null) {
        usesRemaining[feature.featureId] = feature.usesRemaining;
      }
    }

    return {
      features,
      usesRemaining,
    };
  }
}
