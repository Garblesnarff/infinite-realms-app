import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { chunkCampaignFiles } from './chunker.js';

test('extracts a Handouts section into RAG-searchable keyed chunks', () => {
  const { chunks } = chunkCampaignFiles('campaigns/eternal-feast', {
    campaignBible: `## Handouts

### Balthazar's Recipe Card
Key: \`balthazars-recipe\`
Title: Balthazar's Recipe Card
Giver: Balthazar
Body:
Fold the saffron into the dough at dawn.\n\nKeep the oven door shut.`,
  });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], {
    campaignId: 'eternal-feast',
    chunkType: 'handout',
    entityName: "Balthazar's Recipe Card",
    content:
      "**Balthazar's Recipe Card**\n\nGiver: Balthazar\n\nFold the saffron into the dough at dawn.\n\nKeep the oven door shut.",
    summary: "Handout from Balthazar: Balthazar's Recipe Card",
    metadata: {
      key: 'balthazars-recipe',
      title: "Balthazar's Recipe Card",
      giver: 'Balthazar',
      body: 'Fold the saffron into the dough at dawn.\n\nKeep the oven door shut.',
    },
    sourceFile: 'campaign_bible.md',
    sourceSection: 'Handouts',
  });
});
