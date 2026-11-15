import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ProgressionMechanics } from '../server-bun/src/services/progression/progression-mechanics';
import { abilityModifier } from '../shared/ability-modifier';
import { proficiencyBonus } from '../shared/proficiency-bonus';
import { levelFromXp, XP_TO_REACH_LEVEL } from '../shared/xp-tables';
import { experienceTable, getLevelFromExperience } from '../src/data/levelProgression';
import { calculateProficiencyBonus } from '../src/utils/character/basic-math';

const APP_ROOT = join(__dirname, '..');
const PRODUCTION_ROOTS = ['src', 'server-bun/src', 'shared'];
const INLINE_XP_ROW = /^\s*2:\s*300\b/;

function productionSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (['node_modules', '__tests__', 'test-fixtures'].includes(name)) return [];
      return productionSourceFiles(path);
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.|\.spec\./.test(name)) return [];
    return [path];
  });
}

/** Pinned from origin/main 0182e901 before the XP table copy moved. */
const MODIFIER_BY_SCORE_1_TO_30 = [
  -5, -4, -4, -3, -3, -2, -2, -1, -1, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9,
  10,
] as const;

/** 2014 PHB p. 15, levels 1-20. */
const PROFICIENCY_BY_LEVEL_1_TO_20 = [
  2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
] as const;

/** 2014 PHB p. 15, total XP to reach each level. */
const XP_TO_REACH_LEVEL_1_TO_20 = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000,
  195000, 225000, 265000, 305000, 355000,
] as const;

describe('SRD arithmetic table (scores 1-30, levels 1-20, XP thresholds)', () => {
  it('pins abilityModifier for every score from 1 to 30', () => {
    expect(MODIFIER_BY_SCORE_1_TO_30).toHaveLength(30);
    for (let score = 1; score <= 30; score += 1) {
      expect(abilityModifier(score)).toBe(MODIFIER_BY_SCORE_1_TO_30[score - 1]);
    }
  });

  it('pins proficiencyBonus for every level from 1 to 20', () => {
    expect(PROFICIENCY_BY_LEVEL_1_TO_20).toHaveLength(20);
    for (let level = 1; level <= 20; level += 1) {
      expect(proficiencyBonus(level)).toBe(PROFICIENCY_BY_LEVEL_1_TO_20[level - 1]);
      expect(calculateProficiencyBonus(level)).toBe(PROFICIENCY_BY_LEVEL_1_TO_20[level - 1]);
    }
  });

  it('pins the XP-to-level table and both readers of it', () => {
    expect(XP_TO_REACH_LEVEL_1_TO_20).toHaveLength(20);
    for (let level = 1; level <= 20; level += 1) {
      const xp = XP_TO_REACH_LEVEL_1_TO_20[level - 1];
      expect(XP_TO_REACH_LEVEL[level]).toBe(xp);
      expect(experienceTable[level]).toBe(xp);
      expect(levelFromXp(xp)).toBe(level);
      expect(getLevelFromExperience(xp)).toBe(level);
      expect(ProgressionMechanics.calculateLevelFromXP(xp)).toBe(level);
      if (level > 1) {
        expect(getLevelFromExperience(xp - 1)).toBe(level - 1);
        expect(ProgressionMechanics.calculateLevelFromXP(xp - 1)).toBe(level - 1);
      }
    }
    expect(getLevelFromExperience(0)).toBe(1);
    expect(getLevelFromExperience(999999)).toBe(20);
    expect(ProgressionMechanics.calculateLevelFromXP(0)).toBe(1);
    expect(ProgressionMechanics.calculateLevelFromXP(999999)).toBe(20);
  });

  it('keeps the XP-to-level row only in shared/xp-tables.ts', () => {
    const offenders = PRODUCTION_ROOTS.flatMap((root) =>
      productionSourceFiles(join(APP_ROOT, root)),
    )
      .filter((file) => !file.endsWith(join('shared', 'xp-tables.ts')))
      .filter((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .some((line) => INLINE_XP_ROW.test(line)),
      )
      .map((file) => relative(APP_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
