/**
 * #374 item 4 — the no-XP audit lists authored stat blocks that carry no
 * explicit XP, so new-campaign content errors are caught instead of silently
 * falling back to the threshold award at seating.
 */
import { describe, expect, test } from 'bun:test';

import { buildCampaignMonsterIndex, findBlocksMissingXp } from '../campaign-monster-index.js';


const WITH_XP = `**Goblin Boss**

**HP:** 21 **AC:** 15 **Speed:** 30ft
**XP:** 100
**Attack:** +4 to hit, 1d6+2 slashing`;

const WITHOUT_XP = `**Cave Fisher**

**HP:** 58 **AC:** 13 **Speed:** 20ft
**Attack:** +5 to hit, 2d6+3 piercing`;

const NPC_BIO = `17. **The Innkeeper** (Human) - Runs the tavern. **Voice:** Warm and
welcoming. **Goal:** Keep the peace. **Secret:** Waters down the ale.`;

describe('findBlocksMissingXp', () => {
  test('lists only stat blocks that lack an explicit XP', () => {
    const index = buildCampaignMonsterIndex('test-campaign', [
      { entityName: 'Goblin Boss', chunkType: 'monster', content: WITH_XP },
      { entityName: 'Cave Fisher', chunkType: 'monster', content: WITHOUT_XP },
      { entityName: 'The Innkeeper', chunkType: 'npc_tier2', content: NPC_BIO },
    ]);
    const missing = findBlocksMissingXp(index);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      campaignId: 'test-campaign',
      entityName: 'Cave Fisher',
      chunkType: 'monster',
    });
  });

  test('an empty index reports nothing', () => {
    const index = buildCampaignMonsterIndex('test-campaign', []);
    expect(findBlocksMissingXp(index)).toEqual([]);
  });

  test('results are sorted by entity name', () => {
    const index = buildCampaignMonsterIndex('test-campaign', [
      { entityName: 'Zebra', chunkType: 'monster', content: '**HP:** 10\n**AC:** 10' },
      { entityName: 'Axe Beak', chunkType: 'monster', content: '**HP:** 19\n**AC:** 11' },
    ]);
    const missing = findBlocksMissingXp(index).map((m) => m.entityName);
    expect(missing).toEqual(['Axe Beak', 'Zebra']);
  });
});
