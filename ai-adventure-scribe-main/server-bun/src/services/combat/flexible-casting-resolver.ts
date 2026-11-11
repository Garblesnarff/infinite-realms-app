/**
 * Flexible Casting in a fight (#1233). A bonus action: `convert` turns a spell slot into sorcery
 * points, `create` spends sorcery points on a spell slot. The spend goes through the class-feature
 * use path the sheet uses, so the 2014 table, the created-slot cap and the pool are the engine's,
 * not this file's. This file only finds the character's own Flexible Casting row and names the
 * option. A refusal throws, so the bonus action claim is refunded (see combat-intent-service).
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characterFeatures, classFeaturesLibrary } from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';
import { ClassFeatureUsageService } from '../progression/class-feature-usage-service.js';

export type FlexibleCastingDirection = 'convert' | 'create';

/** The sheet feature each direction spends, by its library name. */
export const FLEXIBLE_CASTING_FEATURE_NAMES: Record<FlexibleCastingDirection, string> = {
  convert: 'Flexible Casting: Converting Spell Slot',
  create: 'Flexible Casting: Creating Spell Slots',
};

export interface FlexibleCastingResult {
  message: string;
  usesRemaining: number;
  effect: string;
}

export async function resolveFlexibleCasting(input: {
  characterId: string;
  userId: string;
  sessionId: string;
  direction: FlexibleCastingDirection;
  slotLevel: number;
}): Promise<FlexibleCastingResult> {
  const featureName = FLEXIBLE_CASTING_FEATURE_NAMES[input.direction];
  const [held] = await db
    .select({ featureId: characterFeatures.featureId })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(
      and(
        eq(characterFeatures.characterId, input.characterId),
        eq(classFeaturesLibrary.featureName, featureName),
      ),
    )
    .limit(1);
  if (!held) {
    throw new BusinessLogicError(`${featureName} is not on this character's sheet`, {
      reason: 'feature_not_on_sheet',
      featureName,
    });
  }
  const result = await ClassFeatureUsageService.spendFeatureUse({
    characterId: input.characterId,
    featureId: held.featureId,
    sessionId: input.sessionId,
    option: String(input.slotLevel),
    userId: input.userId,
  });
  if (!result.success) {
    throw new BusinessLogicError(result.message, { reason: 'feature_refused', featureName });
  }
  return {
    message: result.message,
    usesRemaining: result.usesRemaining,
    effect: result.effect,
  };
}
