/**
 * #1225: spend and refill limited class features by the engine's count
 * (`shared/limited-feature-counts.ts`), not by whatever `uses_count` the library row carries.
 *
 * The generic sheet spend (`ClassFeatureUsageService.spendFeatureUse`) used to read a NULL
 * library count as "unlimited", so most features from the generated SRD seed (Rage, Ki, Channel
 * Divinity, Wild Shape...) could be used again and again and no rest restored them. Here:
 *
 * - The count comes from the class level and ability modifiers (`usesAt`).
 * - A feature the seeds split into tier rows (Channel Divinity "(1/rest)", "(2/rest)"...) is one
 *   family with ONE count: whichever tier row the sheet sends, the spend draws on the family's
 *   canonical row -- the highest tier the character holds at or below their class level (the
 *   same choice #1181 made for Action Surge). Holding several tiers no longer adds their counts.
 * - A count the engine cannot compute (no ability scores) is refused, never guessed.
 *
 * @module server/services/progression/limited-feature-uses
 */

import { and, desc, eq, exists, gt, inArray, like, or, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  featureUsageLog,
} from '../../../../db/schema/index';
import { abilityModifier } from '../../../../shared/ability-modifier';
import {
  limitedFeatureRule,
  type AbilityName,
  type LimitedFeatureContext,
  type LimitedFeatureRule,
} from '../../../../shared/limited-feature-counts';

type CountRule = Extract<LimitedFeatureRule, { kind: 'count' }>;

/** Families another service spends and refills itself (fighter-features-service, #975/#1187). */
const FIGHTER_SERVICE_FAMILIES = new Set(['fighter-second-wind', 'fighter-action-surge']);

const ABILITIES: AbilityName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** Levels in one class: `class_levels` entries win; else the single class and level. */
export function classLevelOf(
  character: { class: string | null; level: number | null; classLevels: unknown },
  className: string,
): number {
  const wanted = className.toLowerCase();
  const entries = Array.isArray(character.classLevels) ? character.classLevels : [];
  let multiclass = 0;
  for (const entry of entries) {
    const name = (entry as { className?: unknown })?.className;
    const level = (entry as { level?: unknown })?.level;
    if (typeof name === 'string' && name.toLowerCase() === wanted) {
      multiclass += typeof level === 'number' && level > 0 ? Math.trunc(level) : 0;
    }
  }
  if (multiclass > 0) return multiclass;
  return (character.class ?? '').toLowerCase() === wanted ? (character.level ?? 0) : 0;
}

/** The feature context for one character and class, or null when the character is not the user's. */
export async function limitedFeatureContext(
  characterId: string,
  userId: string,
  className: string,
): Promise<LimitedFeatureContext | null> {
  const [character] = await db
    .select({
      class: characters.class,
      level: characters.level,
      classLevels: characters.classLevels,
    })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  if (!character) return null;
  const [stats] = await db
    .select({
      strength: characterStats.strength,
      dexterity: characterStats.dexterity,
      constitution: characterStats.constitution,
      intelligence: characterStats.intelligence,
      wisdom: characterStats.wisdom,
      charisma: characterStats.charisma,
    })
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId))
    .limit(1);
  const abilityModifiers = stats
    ? Object.fromEntries(
        ABILITIES.filter((ability) => typeof stats[ability] === 'number').map((ability) => [
          ability,
          abilityModifier(stats[ability] as number),
        ]),
      )
    : null;
  return { classLevel: classLevelOf(character, className), abilityModifiers };
}

type HeldRow = {
  characterFeatureId: string;
  featureId: string;
  featureName: string;
  levelAcquired: number;
  usesRemaining: number | null;
};

/** The character's rows of one family; the canonical row is the highest tier at or below the level. */
async function heldFamilyRows(
  characterId: string,
  className: string,
  family: string,
): Promise<HeldRow[]> {
  const rows = await db
    .select({
      characterFeatureId: characterFeatures.id,
      featureId: characterFeatures.featureId,
      featureName: classFeaturesLibrary.featureName,
      levelAcquired: classFeaturesLibrary.levelAcquired,
      usesRemaining: characterFeatures.usesRemaining,
    })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(
      and(
        eq(characterFeatures.characterId, characterId),
        eq(classFeaturesLibrary.className, className),
      ),
    );
  return rows.filter((row) => {
    const rule = limitedFeatureRule(className, row.featureName);
    return rule?.kind === 'count' && rule.family === family;
  });
}

function canonicalRow(rows: HeldRow[], classLevel: number): HeldRow | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort(
    (a, b) =>
      b.levelAcquired - a.levelAcquired ||
      (a.featureName < b.featureName ? -1 : a.featureName > b.featureName ? 1 : 0),
  );
  return ordered.find((row) => row.levelAcquired <= classLevel) ?? ordered[ordered.length - 1];
}

export type CountedSpendResult =
  | { ok: true; featureId: string; featureName: string; usesRemaining: number }
  | { ok: false; reason: string };

/**
 * Spend uses of a counted feature, atomically, on its family's canonical row. The caller logs
 * the usage against the returned feature id.
 *
 * `spentBy` (round 2): a feature with no uses of its own that draws `cost` from this family
 * (Turn Undead takes one Channel Divinity use; Empty Body takes 4 ki). Its refusals name it.
 */
export async function spendCountedFeatureUse(input: {
  characterId: string;
  userId: string;
  className: string;
  featureName: string;
  rule: CountRule;
  spentBy?: { featureName: string; cost: number };
}): Promise<CountedSpendResult> {
  const { characterId, userId, className, featureName, rule, spentBy } = input;
  const cost = spentBy?.cost ?? 1;
  const ctx = await limitedFeatureContext(characterId, userId, className);
  if (!ctx) return { ok: false, reason: 'Feature not found for this character' };
  const canonical = canonicalRow(
    await heldFamilyRows(characterId, className, rule.family),
    ctx.classLevel,
  );
  if (!canonical) {
    return {
      ok: false,
      reason: spentBy
        ? `${spentBy.featureName} spends ${featureName}, which this character does not have`
        : 'Feature not found for this character',
    };
  }

  const full = rule.usesAt(ctx);
  if (full === 'unlimited') {
    return {
      ok: true,
      featureId: canonical.featureId,
      featureName: canonical.featureName,
      usesRemaining: -1,
    };
  }
  if (full === null) {
    return {
      ok: false,
      reason: `${featureName} is not spent: its uses depend on an ability score this character has none of`,
    };
  }
  if (full <= 0) {
    return { ok: false, reason: `${featureName} has no uses at this character's level` };
  }

  const [updated] = await db
    .update(characterFeatures)
    .set({
      usesRemaining: sql`LEAST(COALESCE(${characterFeatures.usesRemaining}, ${full}), ${full}) - ${cost}`,
    })
    .where(
      and(
        eq(characterFeatures.id, canonical.characterFeatureId),
        sql`LEAST(COALESCE(${characterFeatures.usesRemaining}, ${full}), ${full}) >= ${cost}`,
        exists(
          db
            .select({ one: sql`1` })
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
  if (!updated) {
    return {
      ok: false,
      reason: spentBy
        ? `Not enough ${featureName} left for ${spentBy.featureName} (it costs ${cost})`
        : `No uses remaining for ${featureName}`,
    };
  }
  return {
    ok: true,
    featureId: canonical.featureId,
    featureName: canonical.featureName,
    usesRemaining: updated.usesRemaining ?? 0,
  };
}

/**
 * The character_features rows the counted refill below owns: the generic library-count restore
 * skips them, so a row whose stored `uses_per_rest` is wrong (Arcane Recovery was seeded
 * `short_rest`) cannot be refilled by its tag. Fighter Second Wind / Action Surge keep the
 * generic restore plus their own service.
 */
export async function engineRefilledRowIds(characterId: string): Promise<string[]> {
  const held = await db
    .select({
      characterFeatureId: characterFeatures.id,
      className: classFeaturesLibrary.className,
      featureName: classFeaturesLibrary.featureName,
    })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(eq(characterFeatures.characterId, characterId));
  return held
    .filter((row) => {
      const rule = limitedFeatureRule(row.className, row.featureName);
      return rule?.kind === 'count' && !FIGHTER_SERVICE_FAMILIES.has(rule.family);
    })
    .map((row) => row.characterFeatureId);
}

/**
 * #1232: Divine Intervention stays spent for 7 days after a success. The generic restore
 * carries that hold in SQL, but a Divine Intervention row is engine-refilled (its seed count
 * is NULL, so the generic restore skips it) — the engine refill must honour the hold too, or a
 * long rest inside the window brings it back. A later logged failure ends the hold: no failure
 * after the latest success within 7 days means the hold applies, which is exactly the SQL's
 * EXISTS-success-with-no-later-failure (any failure after the latest success is after every
 * earlier success too).
 */
async function divineInterventionHeld(characterId: string, featureId: string): Promise<boolean> {
  const successes = await db
    .select({ usedAt: featureUsageLog.usedAt })
    .from(featureUsageLog)
    .where(
      and(
        eq(featureUsageLog.characterId, characterId),
        eq(featureUsageLog.featureId, featureId),
        like(featureUsageLog.context, '%divine-intervention:success%'),
        gt(featureUsageLog.usedAt, sql`NOW() - INTERVAL '7 days'`),
      ),
    )
    .orderBy(desc(featureUsageLog.usedAt))
    .limit(1);
  if (successes.length === 0) return false;
  const failures = await db
    .select({ id: featureUsageLog.id })
    .from(featureUsageLog)
    .where(
      and(
        eq(featureUsageLog.characterId, characterId),
        eq(featureUsageLog.featureId, featureId),
        gt(featureUsageLog.usedAt, successes[0].usedAt),
        like(featureUsageLog.context, '%divine-intervention:failure%'),
      ),
    )
    .limit(1);
  return failures.length === 0;
}

/**
 * The rest refill for counted features: each family's canonical row goes back to the engine's
 * count when this rest recharges it (a short rest refills short-rest features; a long rest
 * refills both). Which rest recharges a family is the table's `rechargeAt`, never the row's
 * stored tag; the generic restore skips these rows (`engineRefilledRowIds`). Fighter Second Wind / Action Surge are left to fighter-features-service, and
 * pools (Lay on Hands, Divine Sense) to paladin-features-service. Returns the names refilled.
 */
export async function refillCountedFeatures(
  characterId: string,
  userId: string,
  restType: 'short' | 'long',
): Promise<string[]> {
  const held = await db
    .select({
      className: classFeaturesLibrary.className,
      featureName: classFeaturesLibrary.featureName,
    })
    .from(characterFeatures)
    .innerJoin(classFeaturesLibrary, eq(characterFeatures.featureId, classFeaturesLibrary.id))
    .where(eq(characterFeatures.characterId, characterId));
  const families = new Map<string, { className: string; rule: CountRule }>();
  for (const row of held) {
    const rule = limitedFeatureRule(row.className, row.featureName);
    if (rule?.kind !== 'count' || FIGHTER_SERVICE_FAMILIES.has(rule.family)) continue;
    families.set(`${row.className}|${rule.family}`, { className: row.className, rule });
  }

  const refilled: string[] = [];
  for (const { className, rule } of families.values()) {
    const ctx = await limitedFeatureContext(characterId, userId, className);
    if (!ctx) continue;
    const canonical = canonicalRow(
      await heldFamilyRows(characterId, className, rule.family),
      ctx.classLevel,
    );
    if (!canonical) continue;
    if (restType === 'short' && rule.rechargeAt(ctx) !== 'short_rest') continue;
    // #1232: a long rest inside the 7-day window after a Divine Intervention success
    // must not refill it (see divineInterventionHeld above).
    if (
      rule.family === 'cleric-divine-intervention' &&
      (await divineInterventionHeld(characterId, canonical.featureId))
    ) {
      continue;
    }
    const full = rule.usesAt(ctx);
    if (typeof full !== 'number' || canonical.usesRemaining === full) continue;
    await db
      .update(characterFeatures)
      .set({ usesRemaining: full })
      .where(inArray(characterFeatures.id, [canonical.characterFeatureId]));
    refilled.push(canonical.featureName);
  }
  return refilled;
}
