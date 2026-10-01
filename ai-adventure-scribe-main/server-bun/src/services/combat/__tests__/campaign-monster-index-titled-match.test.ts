/**
 * The one inexact rule in the authored-creature lookup: "<title> <surname>" reaches the single
 * bible entry it abbreviates. Fixtures go through `buildCampaignMonsterIndex`, the real
 * producer of the index, with the same chunk shape the lore-keeper emits for NPCs.
 */
import { describe, expect, test } from 'bun:test';

import {
  buildCampaignMonsterIndex,
  findAuthoredMonster,
  findBibleNameInProse,
} from '../campaign-monster-index.js';

const npc = (entityName: string, hp: number) => ({
  entityName,
  chunkType: 'npc_tier1',
  content: `**${entityName}** (Human Fighter)\n*   *HP:* ${hp}, *AC:* 15.\n*   *Attack:* +3 to hit, 1d8 slashing`,
});

/** An NPC bio with no stat block, as the lore-keeper emits one (the Quill chunk in the real-db suite). */
const blocklessNpc = (entityName: string) => ({
  entityName,
  chunkType: 'npc_tier1',
  content: `**${entityName}** (Human Fighter) - Brisk.\n*   **Goal:** Hold the gate.`,
});

const bestiary = (entityName: string, hp: number) => ({
  entityName,
  chunkType: 'monster',
  content: `**${entityName}**\n\n*HP:* ${hp}, *AC:* 14.\n*Attack:* +4 to hit, 1d10 slashing`,
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

describe('findAuthoredMonster: what the titled match counts (#2427 follow-up)', () => {
  test('a three-token seat reaches the one entry it abbreviates', () => {
    const wide = buildCampaignMonsterIndex('wide', [
      npc('Captain Sarah Jane Reeves', 45),
      npc('Captain Anne Marie Dray', 30),
    ]);
    expect(findAuthoredMonster(wide, null, 'Captain Sarah Reeves')?.entityName).toBe(
      'Captain Sarah Jane Reeves',
    );
    expect(findAuthoredMonster(wide, null, 'Captain Jane Reeves')?.entityName).toBe(
      'Captain Sarah Jane Reeves',
    );
    expect(findAuthoredMonster(wide, null, 'Captain Anne Reeves')).toBeNull();
  });

  test('a three-token seat with two candidates keeps the fallback', () => {
    const twins = buildCampaignMonsterIndex('twins', [
      npc('Captain Sarah Jane Reeves', 45),
      npc('Captain Sarah Anne Reeves', 40),
    ]);
    expect(findAuthoredMonster(twins, null, 'Captain Sarah Reeves')).toBeNull();
  });

  test('punctuation and case in the seat label do not matter', () => {
    for (const label of [
      'Captain Reeves.',
      '"Captain" Reeves',
      'CAPTAIN  REEVES!',
      'captain-reeves',
    ]) {
      expect(findAuthoredMonster(index, null, label)?.entityName).toBe('Captain Sarah Reeves');
    }
  });

  test('punctuation in the bible name does not hide the entry either', () => {
    const quoted = buildCampaignMonsterIndex('quoted', [npc('Captain Sarah "Red" Reeves', 45)]);
    expect(findAuthoredMonster(quoted, null, 'Captain Reeves')?.entityName).toBe(
      'Captain Sarah "Red" Reeves',
    );
  });

  test('a block-less sibling counts: "Lieutenant Voss" keeps the fallback', () => {
    const withSibling = buildCampaignMonsterIndex('sibling', [
      npc('Lieutenant Dray Voss', 30),
      blocklessNpc('Lieutenant Kell Voss'),
    ]);
    expect(findAuthoredMonster(withSibling, null, 'Lieutenant Voss')).toBeNull();
  });

  test('a lone block-less NPC has no stat block to return', () => {
    const lone = buildCampaignMonsterIndex('lone', [blocklessNpc('Lieutenant Kell Voss')]);
    expect(findAuthoredMonster(lone, null, 'Lieutenant Voss')).toBeNull();
  });

  test('a block-less NPC does not count twice when a later chunk gives it a block', () => {
    const later = buildCampaignMonsterIndex('later', [
      blocklessNpc('Captain Sarah Reeves'),
      npc('Captain Sarah Reeves', 45),
    ]);
    expect(findAuthoredMonster(later, null, 'Captain Reeves')?.entityName).toBe(
      'Captain Sarah Reeves',
    );
  });

  test('bestiary names are not NPCs: a title-shaped monster is neither matched nor a rival', () => {
    const mixed = buildCampaignMonsterIndex('mixed', [
      bestiary('Elder Frost Wyrm', 200),
      npc('Lord Aldric Vane', 40),
      bestiary('Lord Of Storms Vane', 150),
    ]);
    expect(findAuthoredMonster(mixed, null, 'Elder Wyrm')).toBeNull();
    expect(findAuthoredMonster(mixed, null, 'Lord Vane')?.entityName).toBe('Lord Aldric Vane');
  });
});

describe('findBibleNameInProse (#2444)', () => {
  const bible = buildCampaignMonsterIndex('bible', [
    npc('Captain Sarah Reeves', 45),
    blocklessNpc('Lieutenant Kell Voss'),
    bestiary('Bitter End Mercenary', 20),
    npc('The Gatekeeper', 12),
  ]);
  const none = () => false;

  test('finds the entry whose full name the prose carries, article dropped', () => {
    expect(findBibleNameInProse(bible, 'Captain Sarah Reeves levels her pistol.', none)).toBe(
      'Captain Sarah Reeves',
    );
    expect(findBibleNameInProse(bible, 'You see the gatekeeper, asleep.', none)).toBe('Gatekeeper');
    expect(findBibleNameInProse(bible, 'Lieutenant Kell Voss, hand on his hilt.', none)).toBe(
      'Lieutenant Kell Voss',
    );
  });

  test('takes the earliest name in the prose', () => {
    expect(
      findBibleNameInProse(
        bible,
        'The Bitter End Mercenary shoves past Captain Sarah Reeves.',
        none,
      ),
    ).toBe('Bitter End Mercenary');
  });

  test('names only: a part of a name is not a name', () => {
    expect(
      findBibleNameInProse(bible, 'Captain Reeves raises a hand. Sarah smiles.', none),
    ).toBeNull();
    expect(findBibleNameInProse(bible, 'Kell Voss waits.', none)).toBeNull();
  });

  test('skips a name the caller rules out and takes the next', () => {
    expect(
      findBibleNameInProse(
        bible,
        'Captain Sarah Reeves and the Bitter End Mercenary face you.',
        (name) => name === 'Captain Sarah Reeves',
      ),
    ).toBe('Bitter End Mercenary');
  });

  test('answers null for an empty index or prose that names nobody', () => {
    expect(findBibleNameInProse(bible, 'Nothing stirs.', none)).toBeNull();
    expect(
      findBibleNameInProse(buildCampaignMonsterIndex('empty', []), 'Captain Sarah Reeves', none),
    ).toBeNull();
  });
});
