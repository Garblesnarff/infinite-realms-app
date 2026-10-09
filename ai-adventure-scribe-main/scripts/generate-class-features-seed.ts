/**
 * Generates the SRD class-features seed migration for `class_features_library` (#2718 step c).
 *
 * Nothing in the migration is typed by hand. Names and levels come from the repo's SRD data:
 * `src/data/srd/progressions.json` (each class's table, levels 1–20) and
 * `src/data/classes/subclasses.ts` (the SRD subclass of each class). Usage and recharge are read
 * from each feature's own SRD description by the rules in `classify` below (with the few
 * `USAGE_OVERRIDES` it explains), and left NULL where the description states none.
 *
 *   bun scripts/generate-class-features-seed.ts > supabase/migrations/20261009_seed_srd_class_features.sql
 *
 * The output is additive and idempotent: inserts only, a deterministic id per row with
 * `ON CONFLICT (id) DO NOTHING`, and a row the library already holds under the same class,
 * subclass, level and name (ignoring a "(2 uses)"-style suffix) is skipped.
 */
import { createHash } from 'node:crypto';

import { classSubclasses } from '../src/data/classes/subclasses';
import progressions from '../src/data/srd/progressions.json';

interface SeedRow {
  className: string;
  subclassName: string | null;
  featureName: string;
  level: number;
  description: string;
  usageType: 'passive' | 'action' | 'bonus_action' | 'reaction' | 'limited_use';
  usesPerRest: 'short_rest' | 'long_rest' | null;
  usesCount: number | null;
}

const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Where the description's wording gives the wrong usage, judged against the SRD rule itself.
 * Martial Arts mentions a bonus-action strike but is not a feature anyone "uses"; claimable, its
 * everyday name ("I use martial arts") would refuse every other class. The others spend ki, spell
 * slots or sorcery points without the description naming an action or a rest.
 */
const USAGE_OVERRIDES: Record<string, SeedRow['usageType']> = {
  'Martial Arts': 'passive',
  'Divine Smite': 'limited_use',
  'Stunning Strike': 'limited_use',
  'Quivering Palm': 'limited_use',
  Metamagic: 'limited_use',
};

/** "Thief’s Reflexes" is typed "Thief's Reflexes"; the library holds the plain apostrophe. */
const plainName = (name: string): string => name.replace(/[\u2018\u2019]/g, "'");

/** How a feature is used and when it comes back, as its SRD description states it. */
export function classify(
  name: string,
  description: string,
): Pick<SeedRow, 'usageType' | 'usesPerRest' | 'usesCount'> {
  const text = description.toLowerCase();
  // "Once per long rest" wins over "during a short rest" (Natural Recovery); "a short or long
  // rest" is a short-rest recharge.
  const usesPerRest = /short or long rest/.test(text)
    ? 'short_rest'
    : /long rest/.test(text)
      ? 'long_rest'
      : /short rest/.test(text)
        ? 'short_rest'
        : null;
  // The action check runs before the bonus-action one: Action Surge grants "one additional action
  // on top of your regular action and a possible bonus action".
  const usageType = /\breaction\b/.test(text)
    ? 'reaction'
    : /\b(?:use|take|spend) (?:an|your|one additional) action\b|\bas an action\b/.test(text)
      ? 'action'
      : /\bbonus action\b/.test(text)
        ? 'bonus_action'
        : usesPerRest
          ? 'limited_use'
          : 'passive';
  const count = /\((\d+) uses?\)/.exec(name);
  return {
    usageType: USAGE_OVERRIDES[name] ?? usageType,
    usesPerRest,
    usesCount: count ? Number(count[1]) : null,
  };
}

export function seedRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  for (const [classKey, features] of Object.entries(
    progressions as Record<
      string,
      Array<{ level: number; featureName: string; description: string }>
    >,
  )) {
    for (const feature of features) {
      // "Martial Archetype feature" is a placeholder for the subclass row below.
      if (/ feature$/.test(feature.featureName)) continue;
      rows.push({
        className: titleCase(classKey),
        subclassName: null,
        featureName: plainName(feature.featureName),
        level: feature.level,
        description: feature.description,
        ...classify(plainName(feature.featureName), feature.description),
      });
    }
  }
  for (const [classKey, subclasses] of Object.entries(classSubclasses)) {
    for (const subclass of subclasses) {
      for (const feature of subclass.features ?? []) {
        rows.push({
          className: titleCase(classKey),
          subclassName: subclass.name,
          featureName: plainName(feature.name),
          level: feature.level,
          description: feature.description,
          ...classify(plainName(feature.name), feature.description),
        });
      }
    }
  }
  return rows;
}

const literal = (value: string | number | null): string =>
  value === null
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : `'${value.replace(/'/g, "''")}'`;

/** A stable id per (class, subclass, name, level), so a replay inserts nothing twice. */
const rowId = (row: SeedRow): string => {
  const hex = createHash('md5')
    .update(
      ['srd-class-feature', row.className, row.subclassName ?? '', row.featureName, row.level].join(
        '|',
      ),
    )
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export function migrationSql(rows: SeedRow[]): string {
  const values = rows
    .map(
      (row) =>
        `  (${[
          literal(rowId(row)),
          literal(row.className),
          literal(row.subclassName),
          literal(row.featureName),
          literal(row.level),
          literal(row.description),
          literal(row.usageType),
          literal(row.usesPerRest),
          literal(row.usesCount),
        ].join(', ')})`,
    )
    .join(',\n');
  return `-- #2718 step c: seed class_features_library with the SRD 5.1 (2014) class features.
-- GENERATED by scripts/generate-class-features-seed.ts from src/data/srd/progressions.json and
-- src/data/classes/subclasses.ts; do not edit by hand. ${rows.length} rows.
--
-- Additive and idempotent: inserts only. Each row has a deterministic id (ON CONFLICT DO NOTHING),
-- and a feature the library already holds for the same class, subclass and level under the same
-- name (ignoring a "(2 uses)"-style suffix) is skipped, so the 20251112_06 rows stay as they are.
INSERT INTO class_features_library
  (id, class_name, subclass_name, feature_name, level_acquired, description, usage_type, uses_per_rest, uses_count)
SELECT v.id::uuid, v.class_name, v.subclass_name, v.feature_name, v.level_acquired::integer,
       v.description, v.usage_type, v.uses_per_rest, v.uses_count::integer
FROM (VALUES
${values}
) AS v(id, class_name, subclass_name, feature_name, level_acquired, description, usage_type, uses_per_rest, uses_count)
WHERE NOT EXISTS (
  SELECT 1 FROM class_features_library e
  WHERE e.class_name = v.class_name
    AND e.subclass_name IS NOT DISTINCT FROM v.subclass_name
    AND e.level_acquired = v.level_acquired::integer
    AND lower(regexp_replace(e.feature_name, '\\s*\\(.*\\)\\s*$', ''))
      = lower(regexp_replace(v.feature_name, '\\s*\\(.*\\)\\s*$', ''))
)
ON CONFLICT (id) DO NOTHING;
`;
}

if (import.meta.main) process.stdout.write(migrationSql(seedRows()));
