/**
 * #1225: the SRD class-feature seed generator writes the fixed PHB counts the engine spends by
 * (shared/limited-feature-counts.ts), and the data-only migration backfills exactly those counts
 * on the generated rows that were seeded NULL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classify, rowId, seedRows } from '../../../scripts/generate-class-features-seed';
import { limitedFeatureRule } from '../../../shared/limited-feature-counts';

describe('class-feature seed counts (#1225)', () => {
  it('every limited row the generator writes is either counted by the engine or carries a count', () => {
    const uncovered = seedRows()
      .filter((row) => row.usesPerRest !== null)
      .filter(
        (row) =>
          limitedFeatureRule(row.className, row.featureName) === null && row.usesCount === null,
      )
      .map((row) => `${row.className}/${row.featureName}`);
    expect(uncovered).toEqual([]);
  });

  it('every generated row that spends ki, Channel Divinity, sorcery points or a slot is classified (round 2)', () => {
    // Optional add-on costs on a feature whose own use is free or passive: catching a missile,
    // saving-throw proficiency, the lowest-level free cast, and the damage bonus cost nothing.
    const optionalCost = new Set([
      'Monk/Deflect Missiles',
      'Monk/Diamond Soul',
      'Wizard/Spell Mastery',
      'Sorcerer/Elemental Affinity',
    ]);
    const unclassified = seedRows()
      .filter(
        (row) =>
          /^channel divinity:/i.test(row.featureName) ||
          /spend (\d+ |\w+ )?ki points?|spend ki|sorcery points|expend (one|a) spell slot/i.test(
            row.description,
          ),
      )
      .filter((row) => !optionalCost.has(`${row.className}/${row.featureName}`))
      .filter((row) => limitedFeatureRule(row.className, row.featureName) === null)
      .map((row) => `${row.className}/${row.featureName}`);
    expect(unclassified).toEqual([]);
    for (const name of [
      'Flurry of Blows',
      'Patient Defense',
      'Step of the Wind',
      'Stunning Strike',
      'Quivering Palm',
    ]) {
      expect(limitedFeatureRule('Monk', name)?.kind).toBe('spends');
    }
    expect(limitedFeatureRule('Sorcerer', 'Metamagic')?.kind).toBe('spends');
  });

  it('a counted row carries the rest the engine refills it on (round 2)', () => {
    const counted = seedRows().filter(
      (row) => limitedFeatureRule(row.className, row.featureName)?.kind === 'count',
    );
    const arcaneRecovery = counted.find((row) => row.featureName === 'Arcane Recovery');
    expect(arcaneRecovery?.usesPerRest).toBe('long_rest');
    // The data migration retags exactly the generated rows whose description-read tag differs.
    const sqlText = readFileSync(
      resolve(__dirname, '../../../db/migrations/20261028_limited_feature_counts.sql'),
      'utf8',
    );
    const retagged = new Map(
      [
        ...sqlText.matchAll(
          /UPDATE class_features_library SET uses_per_rest = '(short_rest|long_rest)' WHERE id = '([0-9a-f-]+)' AND uses_per_rest = '(?:short_rest|long_rest)';/g,
        ),
      ].map((m) => [m[2], m[1]]),
    );
    const expected = new Map(
      counted
        .filter((row) => classify(row.featureName, row.description).usesPerRest !== row.usesPerRest)
        .map((row) => [rowId(row), row.usesPerRest]),
    );
    expect(retagged.get('1b83c4d4-34b0-e359-07fc-a31f8a80907c')).toBe('long_rest');
    expect(retagged).toEqual(expected);
  });

  it('the data-only migration backfills exactly the counts the generator now writes', () => {
    const sqlText = readFileSync(
      resolve(__dirname, '../../../db/migrations/20261028_limited_feature_counts.sql'),
      'utf8',
    );
    const migrated = new Map(
      [
        ...sqlText.matchAll(
          /UPDATE class_features_library SET uses_count = (\d+) WHERE id = '([0-9a-f-]+)' AND uses_count IS NULL;/g,
        ),
      ].map((m) => [m[2], Number(m[1])]),
    );
    // Rows whose count used to be NULL (no "(N uses)" suffix) and now comes from the fixed table.
    const expected = new Map(
      seedRows()
        .filter(
          (row) =>
            row.usesPerRest !== null &&
            row.usesCount !== null &&
            classify(row.featureName, row.description).usesCount === null,
        )
        .map((row) => [rowId(row), row.usesCount as number]),
    );
    expect(migrated.size).toBe(16);
    expect(migrated).toEqual(expected);
  });
});
