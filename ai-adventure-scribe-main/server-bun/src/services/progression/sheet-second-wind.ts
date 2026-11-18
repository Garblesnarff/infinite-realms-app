import { and, eq, or, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characterFeatures, characters, classFeaturesLibrary } from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';
import { rollDie } from '../../lib/rng.js';
import { CharacterVitalsService } from '../character-vitals-service.js';
import { fighterLevelOf } from '../combat/fighter-features-service.js';
import { ClassFeatureUsageService } from './class-feature-usage-service.js';

/** The sheet's Second Wind claim, heal and usage record share one transaction. */
export async function useSheetSecondWind(characterId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [character] = await tx.select().from(characters).where(and(
      eq(characters.id, characterId),
      or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
    )).for('update');
    const level = character ? fighterLevelOf(character) : 0;
    if (!character || level <= 0) {
      throw new BusinessLogicError('Second Wind is not on this character’s sheet', { reason: 'feature_not_on_sheet' });
    }
    const [feature] = await tx.select({ id: characterFeatures.id, featureId: characterFeatures.featureId })
      .from(characterFeatures)
      .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
      .where(and(eq(characterFeatures.characterId, characterId), eq(classFeaturesLibrary.className, 'Fighter'), eq(classFeaturesLibrary.featureName, 'Second Wind')))
      .limit(1);
    if (!feature) throw new BusinessLogicError('Second Wind is not on this character’s sheet', { reason: 'feature_not_on_sheet' });
    const [claimed] = await tx.update(characterFeatures)
      .set({ usesRemaining: sql`COALESCE(${characterFeatures.usesRemaining}, 1) - 1` })
      .where(and(eq(characterFeatures.id, feature.id), sql`COALESCE(${characterFeatures.usesRemaining}, 1) > 0`))
      .returning({ remaining: characterFeatures.usesRemaining });
    if (!claimed) throw new BusinessLogicError('Second Wind has no uses remaining — it refreshes on a short rest', { reason: 'feature_uses_exhausted' });
    const roll = rollDie(10);
    const vitals = await CharacterVitalsService.heal(characterId, userId, roll + level, tx);
    await ClassFeatureUsageService.logFeatureUsage(characterId, feature.featureId, userId, 'sheet-second-wind', undefined, tx);
    await tx.update(characters).set({
      classFeatures: sql`jsonb_set(COALESCE(${characters.classFeatures}, '{}'::jsonb), '{second_wind}', jsonb_build_object('currentUses', ${claimed.remaining}, 'maxUses', 1), true)`,
    }).where(eq(characters.id, characterId));
    return { roll, fighterLevel: level, newHp: vitals.currentHitPoints, maxHp: vitals.maxHitPoints, usesRemaining: claimed.remaining };
  });
}
