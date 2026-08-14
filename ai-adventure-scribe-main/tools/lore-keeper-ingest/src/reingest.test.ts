import assert from 'node:assert/strict';

import { test } from 'bun:test';

import {
  campaignChunkIdentity,
  dedupeCampaignChunks,
  mergeMetadataPreservingImageUrl,
  summarizeReingestDiff,
} from './reingest.js';

import type { CampaignChunk } from './types.js';

test('matches legacy formatted names to their cleaned entity identity', () => {
  assert.equal(
    campaignChunkIdentity(
      'academy-of-arcane-gastronomy',
      'location',
      'Loc 3: The Academy Library:',
    ),
    campaignChunkIdentity('academy-of-arcane-gastronomy', 'location', 'The Academy Library'),
  );
  assert.equal(
    campaignChunkIdentity(
      'academy-of-arcane-gastronomy',
      'faction',
      "10. The First Palate's Chosen",
    ),
    campaignChunkIdentity('academy-of-arcane-gastronomy', 'faction', "The First Palate's Chosen"),
  );
  assert.equal(
    campaignChunkIdentity('academy-of-arcane-gastronomy', 'npc_tier2', '"Alchemist"'),
    campaignChunkIdentity('academy-of-arcane-gastronomy', 'npc_tier2', 'Alchemist'),
  );
});

test('preserves an existing image_url while refreshing parser metadata', () => {
  assert.deepEqual(
    mergeMetadataPreservingImageUrl(
      { image_url: 'https://cdn.example/library.png', zone: 'old-zone' },
      { zone: 'new-zone', smell: 'old parchment' },
    ),
    {
      image_url: 'https://cdn.example/library.png',
      zone: 'new-zone',
      smell: 'old parchment',
    },
  );
});

test('dedupes a repeated entity before the upsert batch is sent', () => {
  const chunks: CampaignChunk[] = [
    {
      campaignId: 'academy-of-arcane-gastronomy',
      chunkType: 'location',
      entityName: 'The Academy Library',
      content: 'first',
      metadata: {},
      sourceFile: 'campaign_bible.md',
    },
    {
      campaignId: 'academy-of-arcane-gastronomy',
      chunkType: 'location',
      entityName: 'The Academy Library',
      content: 'second',
      metadata: { image_url: 'https://cdn.example/library.png' },
      sourceFile: 'campaign_bible.md',
    },
  ];

  assert.deepEqual(dedupeCampaignChunks(chunks), [chunks[1]]);
});

test('summarizes added, renamed, unchanged, and image-preserving entities', () => {
  assert.deepEqual(
    summarizeReingestDiff(
      [
        {
          campaignId: 'academy-of-arcane-gastronomy',
          chunkType: 'location',
          entityName: 'The Academy Library',
          content: 'cleaned library',
          metadata: {},
          sourceFile: 'campaign_bible.md',
        },
        {
          campaignId: 'academy-of-arcane-gastronomy',
          chunkType: 'faction',
          entityName: 'The Academy',
          content: 'unchanged faction',
          metadata: {},
          sourceFile: 'campaign_bible.md',
        },
        {
          campaignId: 'academy-of-arcane-gastronomy',
          chunkType: 'item',
          entityName: 'The Saffron Key',
          content: 'new item',
          metadata: {},
          sourceFile: 'campaign_bible.md',
        },
      ],
      [
        {
          id: 'legacy-library',
          campaign_id: 'academy-of-arcane-gastronomy',
          chunk_type: 'location',
          entity_name: 'Loc 3: The Academy Library:',
          metadata: { image_url: 'https://cdn.example/library.png' },
          source_file: 'campaign_bible.md',
          source_section: 'Locations',
          created_at: '2026-08-13T00:00:00.000Z',
        },
        {
          id: 'academy-faction',
          campaign_id: 'academy-of-arcane-gastronomy',
          chunk_type: 'faction',
          entity_name: 'The Academy',
          metadata: {},
          source_file: 'campaign_bible.md',
          source_section: 'Factions',
          created_at: '2026-08-13T00:00:00.000Z',
        },
      ],
    ),
    {
      entitiesAdded: 1,
      entitiesRenamed: 1,
      entitiesUnchanged: 1,
      imageUrlRowsPreserved: 1,
    },
  );
});
