import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { reingestCampaignChunks } from './reingest-database.js';

import type { SupabaseClient } from '@supabase/supabase-js';

type FakeCalls = {
  updates: Array<{ id: string; payload: Record<string, unknown> }>;
  inserts: Array<Record<string, unknown>>;
  deleted: string[];
};

function fakeClient(rows: Array<Record<string, unknown>>): {
  client: SupabaseClient;
  calls: FakeCalls;
} {
  const calls: FakeCalls = { updates: [], inserts: [], deleted: [] };
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
      delete: () => ({
        in: async (_column: string, ids: string[]) => {
          calls.deleted.push(...ids);
          return { data: null, error: null };
        },
      }),
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
