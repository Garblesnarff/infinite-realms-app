/**
 * CLASS_SAVING_THROW_PROFICIENCIES_MAP is the fallback used when a character
 * has no persisted saving-throw proficiencies. It duplicates data that already
 * lives in `src/data/classes/*`, so this test fails the moment the two drift.
 *
 * It listed only four of the twelve classes until 2026-08, which is half of
 * issue #1827: a Monk resolved to "no save proficiencies".
 */

import { describe, it, expect } from 'vitest';

import { classes } from '@/data/classes';
import { CLASS_SAVING_THROW_PROFICIENCIES_MAP } from '@/utils/character-calculations-data';

describe('CLASS_SAVING_THROW_PROFICIENCIES_MAP', () => {
  it('covers every playable class', () => {
    const missing = classes
      .map((entry) => entry.name)
      .filter((name) => !CLASS_SAVING_THROW_PROFICIENCIES_MAP[name]);

    expect(missing).toEqual([]);
  });

  it('agrees with the class dataset', () => {
    for (const entry of classes) {
      expect([...(CLASS_SAVING_THROW_PROFICIENCIES_MAP[entry.name] ?? [])].sort()).toEqual(
        [...entry.savingThrowProficiencies].map(String).sort(),
      );
    }
  });

  it('has no entries for classes that do not exist', () => {
    const known = new Set(classes.map((entry) => entry.name));
    const strays = Object.keys(CLASS_SAVING_THROW_PROFICIENCIES_MAP).filter(
      (name) => !known.has(name),
    );

    expect(strays).toEqual([]);
  });
});
