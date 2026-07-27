/**
 * Playtest run 16 regression: separator-insensitive monster keys.
 *
 * The run-15 fix collapsed non-alphanumerics to `-`, which fixed `stone_golem` vs
 * `stone-golem` and did nothing at all for `stonegolem` vs `stone-golem`. Run 16 then saw
 * the same creature resolve correctly twice and fall back to generic 11 HP seven times in
 * one session, decided purely by whether the DM wrote the word break that turn. `The
 * Doorkeeper` and `Doorkeeper` flipped the same way.
 *
 * The collision check is a test rather than a comment on purpose. Removing separators
 * merges keys that were previously distinct, so "is the catalog still unambiguous?" is a
 * property of the *current* catalog, and a catalog gains entries. Asserting it here means a
 * future entry that collides fails a test instead of silently resolving to the wrong
 * creature — which, being a stat-block swap rather than an error, would show up only as a
 * fight that felt wrong.
 */
import { describe, expect, test } from 'bun:test';

import monsterCatalog from '../../../../../src/data/srd/monsters.json' with { type: 'json' };
import { monsterKeyTokens, normalizeMonsterKey } from '../monster-key.js';

const catalog = monsterCatalog as unknown as Array<{ id: string; name: string }>;

describe('normalizeMonsterKey', () => {
  test('every spelling of a word break produces one key', () => {
    const spellings = [
      'stonegolem',
      'stone-golem',
      'stone_golem',
      'stone golem',
      'srd:stonegolem',
      'srd:stone-golem',
      'srd:stone_golem',
      'Stone Golem',
      'STONE  GOLEM',
      '  srd:Stone-Golem  ',
    ];
    const keys = new Set(spellings.map(normalizeMonsterKey));
    expect([...keys]).toEqual(['stonegolem']);
  });

  test('a leading definite article is not part of the name', () => {
    expect(normalizeMonsterKey('The Doorkeeper')).toBe(normalizeMonsterKey('Doorkeeper'));
    expect(normalizeMonsterKey('the-doorkeeper')).toBe('doorkeeper');
    expect(normalizeMonsterKey('THE Stone Golem')).toBe('stonegolem');
  });

  test('an article-like prefix inside a word survives', () => {
    // `the` is stripped as a word, never as three letters: `theurgist` is not `urgist`.
    expect(normalizeMonsterKey('Theurgist')).toBe('theurgist');
    expect(normalizeMonsterKey('Thessalhydra')).toBe('thessalhydra');
  });

  test('tokens keep the word boundaries the key discards', () => {
    // Near-miss matching in srd-monster-resolution needs tokens; the strict key has none.
    expect(monsterKeyTokens('srd:ancient_red-dragon')).toEqual(['ancient', 'red', 'dragon']);
    expect(monsterKeyTokens('The Stone Golem')).toEqual(['stone', 'golem']);
    // Written without breaks there is no boundary information to recover, and the function
    // says so rather than inventing one.
    expect(monsterKeyTokens('stonegolem')).toEqual(['stonegolem']);
  });
});

describe('catalog collision-freedom under the stricter key', () => {
  test('the catalog is the expected size', () => {
    expect(catalog.length).toBe(334);
  });

  for (const field of ['id', 'name'] as const) {
    test(`all ${field}s remain distinct after normalization`, () => {
      const byKey = new Map<string, string>();
      const collisions: string[] = [];
      for (const entry of catalog) {
        const key = normalizeMonsterKey(entry[field]);
        const existing = byKey.get(key);
        if (existing) collisions.push(`${key}: ${existing} vs ${entry[field]}`);
        else byKey.set(key, entry[field]);
      }
      expect(collisions).toEqual([]);
      expect(byKey.size).toBe(catalog.length);
    });
  }

  test('no entry name normalizes onto a different entry id', () => {
    // The resolver falls back from the id map to the name map and back again, so a
    // cross-namespace collision is as harmful as a same-namespace one.
    const byId = new Map(catalog.map((entry) => [normalizeMonsterKey(entry.id), entry]));
    const crossed = catalog.filter((entry) => {
      const hit = byId.get(normalizeMonsterKey(entry.name));
      return hit && hit.id !== entry.id;
    });
    expect(crossed.map((entry) => entry.name)).toEqual([]);
  });
});
