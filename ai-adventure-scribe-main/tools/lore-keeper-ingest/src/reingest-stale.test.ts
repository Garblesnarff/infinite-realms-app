import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { listStaleRows } from './reingest.js';

import type { ExistingCampaignChunk } from './reingest.js';
import type { CampaignChunk } from './types.js';

function existingRow(
  id: string,
  entityName: string,
  metadata: Record<string, unknown> = {},
  chunkType = 'location',
): ExistingCampaignChunk {
  return {
    id,
    campaign_id: 'the-eternal-feast',
    chunk_type: chunkType,
    entity_name: entityName,
    metadata,
    source_file: 'campaign_bible.md',
    source_section: 'Locations',
    created_at: '2026-08-27T02:44:57.000Z',
  };
}

const empyreaChunk: CampaignChunk = {
  campaignId: 'the-eternal-feast',
  chunkType: 'location',
  entityName: 'Empyrea',
  content: 'The clean-name location.',
  metadata: {},
  sourceFile: 'campaign_bible.md',
  sourceSection: 'Locations',
};

test('lists the old row of a renamed location as stale and leaves the matched row out', () => {
  const stale = listStaleRows(
    [empyreaChunk],
    [existingRow('clean', 'Empyrea'), existingRow('old', 'Empyrea (Light)')],
  );

  assert.deepEqual(stale, [
    {
      id: 'old',
      chunkType: 'location',
      entityName: 'Empyrea (Light)',
      hasImageUrl: false,
      removedByApply: false,
      refusedByApply: false,
      removedByRemoveStale: true,
    },
  ]);
});

test('a stale row with an image_url is listed but never marked for removal', () => {
  const [row] = listStaleRows(
    [empyreaChunk],
    [existingRow('old', 'Empyrea (Light)', { image_url: 'https://cdn.example/empyrea.png' })],
  );

  assert.equal(row?.hasImageUrl, true);
  assert.equal(row?.removedByApply, false);
  assert.equal(row?.removedByRemoveStale, false);
});

test('a legacy-formatted row that matches a parsed chunk is not stale', () => {
  assert.deepEqual(
    listStaleRows(
      [{ ...empyreaChunk, entityName: 'The Academy Library' }],
      [existingRow('legacy', 'Loc 3: The Academy Library:')],
    ),
    [],
  );
});

test('an unused section marker is stale and removed by plain apply, not by --remove-stale', () => {
  const [row] = listStaleRows(
    [empyreaChunk],
    [existingRow('marker', 'TAG: FACTION_DATA', {}, 'faction')],
  );

  assert.equal(row?.removedByApply, true);
  assert.equal(row?.removedByRemoveStale, false);
});

test('an unused section marker with an image_url is flagged as refused by apply, not left', () => {
  const [row] = listStaleRows(
    [empyreaChunk],
    [
      existingRow(
        'marker',
        'TAG: FACTION_DATA',
        { image_url: 'https://cdn.example/m.png' },
        'faction',
      ),
    ],
  );

  assert.equal(row?.refusedByApply, true);
  assert.equal(row?.removedByApply, false);
  assert.equal(row?.removedByRemoveStale, false);
});
