import assert from 'node:assert/strict';

import { mock, test } from 'bun:test';

import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../../shared/embedding-limits.js';

import type { CampaignChunk } from './types.js';

/**
 * The full-ingest write path stamps which model produced each vector, so a corpus embedded by
 * a since-retired model is identifiable with a query instead of a diff against a backup table.
 * See #1816.
 */

const upserts: Array<Array<Record<string, unknown>>> = [];

mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: async (batch: Array<Record<string, unknown>>) => {
        upserts.push(batch);
        return { data: null, error: null };
      },
    }),
  }),
}));

const { initSupabase, insertCampaignChunks } = await import('./database.js');

initSupabase('http://localhost:54321', 'service-role-key');

function chunk(entityName: string): CampaignChunk {
  return {
    campaignId: 'academy-of-arcane-gastronomy',
    chunkType: 'location',
    entityName,
    content: `Content for ${entityName}.`,
    metadata: { zone: 'The Academy' },
    sourceFile: 'campaign_bible.md',
    sourceSection: 'Locations',
  } as CampaignChunk;
}

test('stamps the embedding model on chunks written with a vector', async () => {
  upserts.length = 0;

  await insertCampaignChunks([chunk('The Academy Library')], [[0.1, 0.2, 0.3]]);

  const [row] = upserts[0] ?? [];
  assert.deepEqual(row?.metadata, {
    zone: 'The Academy',
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  });
});

test('leaves metadata unstamped when no embedding is written', async () => {
  upserts.length = 0;

  // `--skip-embeddings` passes no vectors; those rows land with a null embedding and must not
  // claim provenance for a vector they don't have.
  await insertCampaignChunks([chunk('The Academy Library')], []);

  const [row] = upserts[0] ?? [];
  assert.equal(row?.embedding, null);
  assert.deepEqual(row?.metadata, { zone: 'The Academy' });
});
