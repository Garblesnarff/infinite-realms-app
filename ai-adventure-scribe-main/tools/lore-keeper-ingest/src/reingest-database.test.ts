import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { reingestCampaignChunks, removeStaleRows } from './reingest-database.js';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../../../shared/embedding-limits.js';

import type { StaleRow } from './reingest.js';
import type { SupabaseClient } from '@supabase/supabase-js';

type FakeCalls = {
  updates: Array<{ id: string; payload: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
  deleted: string[];
  deleteFilters: Array<{ campaigns: string[]; ids: string[]; noImage: boolean }>;
};

function fakeClient(rows: Array<Record<string, unknown>>): {
  client: SupabaseClient;
  calls: FakeCalls;
} {
  const calls: FakeCalls = { updates: [], inserts: [], deleted: [], deleteFilters: [] };
  const client = {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: null }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          calls.updates.push({ id, payload });
          return { data: null, error: null };
        },
      }),
      insert: async (payload: Record<string, unknown>) => {
        calls.inserts.push(payload);
        return { data: null, error: null };
      },
      // Applies the filters the way PostgREST does, over `rows`: only a row in the filtered
      // campaign, in the id list, and (with the image guard) without metadata.image_url goes.
      delete: () => {
        const filters = { campaigns: [] as string[], ids: [] as string[], noImage: false };
        const builder = {
          eq: (_column: string, value: string) => {
            filters.campaigns.push(value);
            return builder;
          },
          in: (_column: string, ids: string[]) => {
            filters.ids = ids;
            return builder;
          },
          is: (column: string, value: null) => {
            assert.equal(column, 'metadata->>image_url');
            assert.equal(value, null);
            filters.noImage = true;
            return builder;
          },
          select: async () => {
            const hit = rows.filter(
              (candidate) =>
                filters.campaigns.every((campaign) => candidate.campaign_id === campaign) &&
                filters.ids.includes(candidate.id as string) &&
                !(
                  filters.noImage &&
                  (candidate.metadata as Record<string, unknown> | undefined)?.image_url
                ),
            );
            const hitIds = hit.map((candidate) => candidate.id as string);
            calls.deleted.push(...hitIds);
            calls.deleteFilters.push({ ...filters });
            return { data: hitIds.map((id) => ({ id })), error: null };
          },
        };
        return builder;
      },
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

test('updates an asset-bearing legacy row in place and preserves its image URL', async () => {
  const { client, calls } = fakeClient([
    {
      id: 'legacy-library',
      campaign_id: 'academy-of-arcane-gastronomy',
      chunk_type: 'location',
      entity_name: 'Loc 3: The Academy Library:',
      metadata: { image_url: 'https://cdn.example/library.png', zone: 'old-zone' },
      source_file: 'campaign_bible.md',
      source_section: 'Locations',
      created_at: '2026-08-13T00:00:00.000Z',
    },
  ]);

  const result = await reingestCampaignChunks(client, [
    {
      campaignId: 'academy-of-arcane-gastronomy',
      chunkType: 'location',
      entityName: 'The Academy Library',
      content: 'The cleaned library chunk.',
      metadata: { zone: 'The Academy' },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Locations',
    },
  ]);

  assert.equal(result.rowsUpdated, 1);
  assert.equal(result.rowsInserted, 0);
  assert.equal(calls.updates[0]?.id, 'legacy-library');
  assert.equal(calls.updates[0]?.payload.entity_name, 'The Academy Library');
  assert.deepEqual(calls.updates[0]?.payload.metadata, {
    image_url: 'https://cdn.example/library.png',
    zone: 'The Academy',
  });
});

test('removes an unlinked section marker while retaining parsed rows', async () => {
  const { client, calls } = fakeClient([
    {
      id: 'faction-marker',
      campaign_id: 'academy-of-arcane-gastronomy',
      chunk_type: 'faction',
      entity_name: 'TAG: FACTION_DATA',
      metadata: {},
      source_file: 'campaign_bible.md',
      source_section: 'Factions',
      created_at: '2026-08-13T00:00:00.000Z',
    },
  ]);

  const result = await reingestCampaignChunks(client, [
    {
      campaignId: 'academy-of-arcane-gastronomy',
      chunkType: 'faction',
      entityName: 'The Academy of Arcane Gastronomy',
      content: 'The faction chunk.',
      metadata: {},
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Factions',
    },
  ]);

  assert.equal(result.rowsInserted, 1);
  assert.equal(result.sectionMarkerRowsRemoved, 1);
  assert.deepEqual(calls.deleted, ['faction-marker']);
});

test('stamps the embedding model on rows whose vector is rewritten', async () => {
  const { client, calls } = fakeClient([
    {
      id: 'legacy-library',
      campaign_id: 'academy-of-arcane-gastronomy',
      chunk_type: 'location',
      entity_name: 'The Academy Library',
      metadata: { embeddingModel: 'text-embedding-004', embeddingDimensions: 768 },
      source_file: 'campaign_bible.md',
      source_section: 'Locations',
      created_at: '2026-08-13T00:00:00.000Z',
    },
  ]);

  await reingestCampaignChunks(
    client,
    [
      {
        campaignId: 'academy-of-arcane-gastronomy',
        chunkType: 'location',
        entityName: 'The Academy Library',
        content: 'The cleaned library chunk.',
        metadata: {},
        sourceFile: 'campaign_bible.md',
        sourceSection: 'Locations',
      },
    ],
    [[0.1, 0.2, 0.3]],
  );

  assert.deepEqual(calls.updates[0]?.payload.metadata, {
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
  });
});

test('leaves the existing embedding stamp alone when embeddings are skipped', async () => {
  const { client, calls } = fakeClient([
    {
      id: 'legacy-library',
      campaign_id: 'academy-of-arcane-gastronomy',
      chunk_type: 'location',
      entity_name: 'The Academy Library',
      metadata: { embeddingModel: 'text-embedding-004', embeddingDimensions: 768 },
      source_file: 'campaign_bible.md',
      source_section: 'Locations',
      created_at: '2026-08-13T00:00:00.000Z',
    },
  ]);

  await reingestCampaignChunks(client, [
    {
      campaignId: 'academy-of-arcane-gastronomy',
      chunkType: 'location',
      entityName: 'The Academy Library',
      content: 'The cleaned library chunk.',
      metadata: {},
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Locations',
    },
  ]);

  // The row keeps its old vector, so it must keep the stamp describing that vector.
  assert.equal(calls.updates[0]?.payload.embedding, undefined);
  assert.deepEqual(calls.updates[0]?.payload.metadata, {
    embeddingModel: 'text-embedding-004',
    embeddingDimensions: 768,
  });
});

const stale = (id: string, hasImageUrl: boolean, removedByRemoveStale: boolean): StaleRow => ({
  id,
  chunkType: 'location',
  entityName: id,
  hasImageUrl,
  removedByApply: false,
  refusedByApply: false,
  removedByRemoveStale,
});

const chunkRow = (
  id: string,
  campaignId: string,
  metadata: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id,
  campaign_id: campaignId,
  chunk_type: 'location',
  entity_name: id,
  metadata,
  source_file: 'campaign_bible.md',
  source_section: 'Locations',
  created_at: '2026-08-13T00:00:00.000Z',
});

test('removeStaleRows deletes the rows flagged for removal and never one with an image_url', async () => {
  const { client, calls } = fakeClient([
    chunkRow('plain', 'camp-a'),
    chunkRow('with-image', 'camp-a', { image_url: 'https://cdn.example/a.png' }),
    chunkRow('with-image-unflagged', 'camp-a', { image_url: 'https://cdn.example/b.png' }),
  ]);

  const removed = await removeStaleRows(client, 'camp-a', [
    stale('plain', false, true),
    stale('with-image', true, true),
    stale('with-image-unflagged', true, false),
  ]);

  assert.deepEqual(removed, ['plain']);
  assert.deepEqual(calls.deleted, ['plain']);
});

test('removeStaleRows guards the delete in the DB: a row that gained an image_url after the read survives', async () => {
  // The caller's snapshot says the row has no image; the DB row has one by delete time.
  const { client, calls } = fakeClient([
    chunkRow('raced', 'camp-a', { image_url: 'https://cdn.example/new.png' }),
  ]);

  const removed = await removeStaleRows(client, 'camp-a', [stale('raced', false, true)]);

  assert.deepEqual(removed, []);
  assert.deepEqual(calls.deleted, []);
  assert.deepEqual(calls.deleteFilters, [{ campaigns: ['camp-a'], ids: ['raced'], noImage: true }]);
});

test('removeStaleRows never deletes a row of another campaign, even with a matching id in the list', async () => {
  const { client, calls } = fakeClient([
    chunkRow('shared-id', 'camp-b'),
    chunkRow('own', 'camp-a'),
  ]);

  const removed = await removeStaleRows(client, 'camp-a', [
    stale('shared-id', false, true),
    stale('own', false, true),
  ]);

  assert.deepEqual(removed, ['own']);
  assert.deepEqual(calls.deleted, ['own']);
  assert.ok(calls.deleteFilters.every((filter) => filter.campaigns[0] === 'camp-a'));
});
