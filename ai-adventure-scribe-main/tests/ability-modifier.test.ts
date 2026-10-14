import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { abilityModifier } from '../shared/ability-modifier';

const APP_ROOT = join(__dirname, '..');
const PRODUCTION_ROOTS = ['src', 'server-bun/src', 'supabase/functions', 'shared'];
const INLINE_FORMULA = /\(\s*[^()\n]*?\s-\s*10\s*\)\s*\/\s*2\b/;

function hasInlineFormula(source: string): boolean {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .some((line) => INLINE_FORMULA.test(line));
}

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

describe('abilityModifier', () => {
  it.each([
    [1, -5],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [13, 1],
    [14, 2],
    [15, 2],
    [18, 4],
    [20, 5],
    [30, 10],
  ])('score %i gives modifier %i', (score, modifier) => {
    expect(abilityModifier(score)).toBe(modifier);
  });

  it('matches the 2014 formula floor((score - 10) / 2) for every score 1-30', () => {
    for (let score = 1; score <= 30; score += 1) {
      expect(abilityModifier(score)).toBe(Math.floor((score - 10) / 2));
    }
  });

  it('is the only production copy of the modifier formula', () => {
    const offenders = PRODUCTION_ROOTS.flatMap((root) =>
      productionSourceFiles(join(APP_ROOT, root)),
    )
      .filter((file) => !file.endsWith(join('shared', 'ability-modifier.ts')))
      .filter((file) => hasInlineFormula(readFileSync(file, 'utf8')))
      .map((file) => relative(APP_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
