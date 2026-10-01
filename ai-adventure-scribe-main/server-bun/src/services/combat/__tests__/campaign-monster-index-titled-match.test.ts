/**
 * The one inexact rule in the authored-creature lookup: "<title> <surname>" reaches the single
 * bible entry it abbreviates. Fixtures go through `buildCampaignMonsterIndex`, the real
 * producer of the index, with the same chunk shape the lore-keeper emits for NPCs.
 */
import { describe, expect, test } from 'bun:test';

import { buildCampaignMonsterIndex, findAuthoredMonster } from '../campaign-monster-index.js';

const npc = (entityName: string, hp: number) => ({
  entityName,
  chunkType: 'npc_tier1',
  content: `**${entityName}** (Human Fighter)\n*   *HP:* ${hp}, *AC:* 15.\n*   *Attack:* +3 to hit, 1d8 slashing`,
});

const index = buildCampaignMonsterIndex('titled', [
  npc('Captain Sarah Reeves', 45),
  npc('Lieutenant Dray Voss', 30),
  npc('Lieutenant Kell Voss', 35),
  npc('Sarah Quill', 20),
]);

describe('findAuthoredMonster: titled partial names', () => {
  test('a title plus surname reaches the one bible entry', () => {
    expect(findAuthoredMonster(index, null, 'Captain Reeves')?.entityName).toBe(
      'Captain Sarah Reeves',
    );
    expect(findAuthoredMonster(index, null, 'captain reeves')?.parsed.maxHp).toBe(45);
  });

  test('an exact name still wins', () => {
    expect(findAuthoredMonster(index, null, 'Captain Sarah Reeves')?.entityName).toBe(
      'Captain Sarah Reeves',
    );
  });

  test('two candidates keep the fallback', () => {
    expect(findAuthoredMonster(index, null, 'Lieutenant Voss')).toBeNull();
  });

  test('the title must match: no guess across titles', () => {
    expect(findAuthoredMonster(index, null, 'Sergeant Reeves')).toBeNull();
  });

  test('no title, no partial match', () => {
    expect(findAuthoredMonster(index, null, 'Reeves')).toBeNull();
    expect(findAuthoredMonster(index, null, 'Sarah Reeves')).toBeNull();
    expect(findAuthoredMonster(index, null, 'Quill')).toBeNull();
  });

  test('a different surname does not match', () => {
    expect(findAuthoredMonster(index, null, 'Captain Reaves')).toBeNull();
  });

  test('a monsterId that misses does not block the name match', () => {
    expect(findAuthoredMonster(index, 'made_up_id', 'Captain Reeves')?.entityName).toBe(
      'Captain Sarah Reeves',
    );
  });
});
