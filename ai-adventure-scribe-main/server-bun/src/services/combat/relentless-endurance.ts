/**
 * Half-Orc Relentless Endurance (#1635).
 *
 * SRD 5.1: "When you are reduced to 0 hit points but not killed outright, you can
 * drop to 1 hit point instead. You can't use this feature again until you finish
 * a long rest."
 *
 * Shared helper used by both HP writers (CombatHPService and CharacterVitalsService)
 * so the spend and the lazy character_features row stay in one place.
 */

import { and, eq, sql } from 'drizzle-orm';

import {
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
} from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

import type { VitalsTx } from '../character-vitals-service.js';

export const RELENTLESS_ENDURANCE_FEATURE = 'Relentless Endurance';
export const RELENTLESS_ENDURANCE_RACE = 'Half-Orc';

export function relentlessEnduranceLine(name: string): string {
  return `${name} stays on their feet with 1 HP (Relentless Endurance).`;
}

export function wouldRelentlessEnduranceTrigger(input: {
  hpBefore: number;
  newHp: number;
  massiveDamage: boolean;
  isDead: boolean;
}): boolean {
  return input.hpBefore > 0 && input.newHp === 0 && !input.massiveDamage && !input.isDead;
}

function normaliseRace(race: string | null): string {
  return (race ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

export async function spendRelentlessEndurance(
  tx: VitalsTx,
  characterId: string,
): Promise<{ characterName: string } | null> {
  const [char] = await tx
    .select({ name: characters.name, race: characters.race })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);

  if (!char || normaliseRace(char.race) !== 'half-orc') return null;

  // Lock order matches CharacterVitalsService: the character_stats row first (the vitals writer
  // already holds it, so this is a no-op there; the combat writer takes it here, before
  // mirrorFromCombat re-locks it), then the advisory lock that serialises the lazy insert and
  // the spend for a character with no stats row. Both writers take the locks in this order, so
  // a combat hit and an out-of-combat hit on the same character cannot deadlock.
  await tx
    .select({ characterId: characterStats.characterId })
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId))
    .for('update');
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('relentless-endurance:' || ${characterId}, 0))`,
  );

  const [library] = await tx
    .select({ id: classFeaturesLibrary.id })
    .from(classFeaturesLibrary)
    .where(
      and(
        eq(classFeaturesLibrary.className, 'Half-Orc'),
        eq(classFeaturesLibrary.featureName, RELENTLESS_ENDURANCE_FEATURE),
      ),
    )
    .orderBy(classFeaturesLibrary.id)
    .limit(1);

  if (!library) {
    logger.warn({ msg: 'RELENTLESS_ENDURANCE_NO_LIBRARY_ROW', characterId });
    return null;
  }

  let [row] = await tx
    .select({ id: characterFeatures.id, usesRemaining: characterFeatures.usesRemaining })
    .from(characterFeatures)
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(characterFeatures.featureId, library.id),
      ),
    )
    .limit(1);

  if (!row) {
    const [created] = await tx
      .insert(characterFeatures)
      .values({
        characterId,
        featureId: library.id,
        usesRemaining: 1,
        isActive: true,
        acquiredAtLevel: 1,
      })
      .returning({ id: characterFeatures.id, usesRemaining: characterFeatures.usesRemaining });
    if (!created) return null;
    row = created;
  }

  const [updated] = await tx
    .update(characterFeatures)
    .set({ usesRemaining: sql`COALESCE(${characterFeatures.usesRemaining}, 1) - 1` })
    .where(
      and(
        eq(characterFeatures.id, row.id),
        sql`COALESCE(${characterFeatures.usesRemaining}, 1) > 0`,
      ),
    )
    .returning({ id: characterFeatures.id });

  if (!updated) return null;
  return { characterName: char.name ?? '' };
}
