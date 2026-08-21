import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCampaignAsset,
  getDatabaseTarget,
  normalizeAssetType,
  normalizeImageExtension,
  parseCliArgs,
  parseManifestCsv,
  runUpload,
} from '../scripts/upload-campaign-assets';

import type { SupabaseClient } from '@supabase/supabase-js';

describe('upload-campaign-assets', () => {
  it('reads the reconciliation CSV and uses the real image format for storage paths', () => {
    const manifest = parseManifestCsv(
      [
        'file path,campaign slug,type,entity slug,real image format',
        'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,JPEG',
        'renders/card.png,academy-of-arcane-gastronomy,card,cover,image/png',
        'renders/apprentice.png,academy-of-arcane-gastronomy,portraits,the-apprentice,.webp',
        'renders/faction.png,academy-of-arcane-gastronomy,faction,the-collective,image/png',
        'renders/card-character.png,academy-of-arcane-gastronomy,character_card,the-apprentice,png',
      ].join('\n'),
    );

    expect(manifest).toEqual([
      {
        filePath: 'renders/chef.png',
        campaignSlug: 'academy-of-arcane-gastronomy',
        type: 'npc',
        entitySlug: 'chef',
        realImageFormat: 'jpg',
      },
      {
        filePath: 'renders/card.png',
        campaignSlug: 'academy-of-arcane-gastronomy',
        type: 'card',
        entitySlug: 'cover',
        realImageFormat: 'png',
      },
      {
        filePath: 'renders/apprentice.png',
        campaignSlug: 'academy-of-arcane-gastronomy',
        type: 'portrait',
        entitySlug: 'the-apprentice',
        realImageFormat: 'webp',
      },
      {
        filePath: 'renders/faction.png',
        campaignSlug: 'academy-of-arcane-gastronomy',
        type: 'faction',
        entitySlug: 'the-collective',
        realImageFormat: 'png',
      },
      {
        filePath: 'renders/card-character.png',
        campaignSlug: 'academy-of-arcane-gastronomy',
        type: 'character_card',
        entitySlug: 'the-apprentice',
        realImageFormat: 'png',
      },
    ]);

    expect(
      buildCampaignAsset(manifest[0], '/tmp/campaign-assets', 'https://test.supabase.co'),
    ).toMatchObject({
      storagePath: 'starter/academy-of-arcane-gastronomy/npc/chef.jpg',
      publicUrl:
        'https://test.supabase.co/storage/v1/object/public/campaign-images/starter/academy-of-arcane-gastronomy/npc/chef.jpg',
    });
  });

  it('accepts the generated manifest headers and filters excluded campaign rows before type validation', () => {
    const manifest = parseManifestCsv(
      [
        'campaign,type,slug,source,format_actual',
        'academy-of-arcane-gastronomy,icon,mobile-icon,academy-of-arcane-gastronomy/mobile-icon.png,jpeg',
        'the-eternal-feast,npc,chef,the-eternal-feast/characters/chef.png,jpeg',
      ].join('\n'),
      'the-eternal-feast',
    );

    expect(manifest).toEqual([
      {
        filePath: 'the-eternal-feast/characters/chef.png',
        campaignSlug: 'the-eternal-feast',
        type: 'npc',
        entitySlug: 'chef',
        realImageFormat: 'jpg',
      },
    ]);
  });

  it('maps every manifest type to the requested database column', () => {
    expect(getDatabaseTarget('npc')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('monster')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('location')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('item')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('faction')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('scene')).toEqual({
      table: 'campaign_chunks',
      column: 'metadata.image_url',
    });
    expect(getDatabaseTarget('card')).toEqual({
      table: 'starter_campaigns',
      column: 'cover_image_url',
    });
    expect(getDatabaseTarget('banner')).toEqual({
      table: 'starter_campaigns',
      column: 'banner_image_url',
    });
    expect(getDatabaseTarget('portrait')).toEqual({
      table: 'starter_character_templates',
      column: 'portrait_url',
    });
    expect(getDatabaseTarget('character_card')).toEqual({
      table: 'starter_character_templates',
      column: 'card_image_url',
    });
    expect(normalizeAssetType('character_card')).toBe('character_card');
  });

  it('defaults to a dry run and requires an explicit apply flag for mutations', () => {
    expect(parseCliArgs(['/tmp/assets'])).toEqual({
      sourceDir: '/tmp/assets',
      dryRun: true,
      force: false,
    });
    expect(parseCliArgs(['/tmp/assets', '--apply', '--force'])).toEqual({
      sourceDir: '/tmp/assets',
      dryRun: false,
      force: true,
    });
    expect(normalizeImageExtension('image/jpeg')).toBe('jpg');
  });

  it('skips an existing object without --force and still repairs its DB link', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-upload-'));
    await mkdir(join(sourceDir, '_manifest'));
    await mkdir(join(sourceDir, 'renders'));
    await writeFile(join(sourceDir, 'renders', 'chef.png'), 'fake image');
    await writeFile(
      join(sourceDir, '_manifest', 'asset-upload-manifest.csv'),
      [
        'file path,campaign slug,type,entity slug,real image format',
        'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,png',
      ].join('\n'),
    );

    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const storage = {
      list: vi.fn().mockResolvedValue({ data: [{ name: 'chef.png' }], error: null }),
      upload: vi.fn(),
    };
    const client = {
      storage: { from: vi.fn(() => storage) },
      from: vi.fn((table: string) => {
        if (table === 'starter_campaigns') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'academy-of-arcane-gastronomy', slug: 'academy-of-arcane-gastronomy' },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'chunk-1',
                campaign_id: 'academy-of-arcane-gastronomy',
                chunk_type: 'npc_tier1',
                entity_name: 'Chef',
                metadata: { source: 'bible' },
              },
            ],
            error: null,
          }),
          update: vi.fn((values: Record<string, unknown>) => ({
            eq: vi.fn().mockImplementation(async () => {
              updates.push({ table, values });
              return { error: null };
            }),
          })),
        };
      }),
    } as unknown as SupabaseClient;

    const summary = await runUpload({
      sourceDir,
      dryRun: false,
      force: false,
      supabaseUrl: 'https://test.supabase.co',
      client,
    });

    expect(summary).toMatchObject({ total: 1, uploaded: 0, skipped: 1, linked: 1, failed: 0 });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(updates).toEqual([
      {
        table: 'campaign_chunks',
        values: {
          metadata: {
            source: 'bible',
            image_url:
              'https://test.supabase.co/storage/v1/object/public/campaign-images/starter/academy-of-arcane-gastronomy/npc/chef.png',
          },
        },
      },
    ]);
  });

  it('links faction chunks and character cards to their distinct database targets', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-upload-'));
    await mkdir(join(sourceDir, '_manifest'));
    await mkdir(join(sourceDir, 'renders'));
    await writeFile(join(sourceDir, 'renders', 'faction.png'), 'faction image');
    await writeFile(join(sourceDir, 'renders', 'apprentice-card.png'), 'card image');
    await writeFile(
      join(sourceDir, '_manifest', 'asset-upload-manifest.csv'),
      [
        'file path,campaign slug,type,entity slug,real image format',
        'renders/faction.png,academy-of-arcane-gastronomy,faction,the-collective,png',
        'renders/apprentice-card.png,academy-of-arcane-gastronomy,character_card,the-apprentice,png',
      ].join('\n'),
    );

    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const storage = {
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = {
      storage: { from: vi.fn(() => storage) },
      from: vi.fn((table: string) => {
        if (table === 'starter_campaigns') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'campaign-1', slug: 'academy-of-arcane-gastronomy' },
                  error: null,
                }),
              })),
            })),
          };
        }

        const rows =
          table === 'campaign_chunks'
            ? [
                {
                  id: 'chunk-1',
                  campaign_id: 'campaign-1',
                  chunk_type: 'faction',
                  entity_name: 'The Collective',
                  metadata: { source: 'bible' },
                },
              ]
            : [
                {
                  id: 'template-1',
                  starter_campaign_id: 'campaign-1',
                  template_key: 'the-apprentice',
                  name: 'Different Display Name',
                },
              ];

        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ data: rows, error: null }),
          })),
          update: vi.fn((values: Record<string, unknown>) => ({
            eq: vi.fn().mockImplementation(async () => {
              updates.push({ table, values });
              return { error: null };
            }),
          })),
        };
      }),
    } as unknown as SupabaseClient;

    const summary = await runUpload({
      sourceDir,
      dryRun: false,
      force: false,
      supabaseUrl: 'https://test.supabase.co',
      client,
    });

    expect(summary).toMatchObject({ total: 2, uploaded: 2, linked: 2, failed: 0 });
    expect(updates).toEqual([
      {
        table: 'campaign_chunks',
        values: {
          metadata: {
            source: 'bible',
            image_url:
              'https://test.supabase.co/storage/v1/object/public/campaign-images/starter/academy-of-arcane-gastronomy/faction/the-collective.png',
          },
        },
      },
      {
        table: 'starter_character_templates',
        values: {
          card_image_url:
            'https://test.supabase.co/storage/v1/object/public/campaign-images/starter/academy-of-arcane-gastronomy/character_card/the-apprentice.png',
        },
      },
    ]);
  });
});

it('counts an invalid row as failed and continues with later valid rows', async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-upload-'));
  await mkdir(join(sourceDir, '_manifest'));
  await mkdir(join(sourceDir, 'renders'));
  await writeFile(join(sourceDir, 'renders', 'chef.png'), 'fake image');
  await writeFile(
    join(sourceDir, '_manifest', 'asset-upload-manifest.csv'),
    [
      'file path,campaign slug,type,entity slug,real image format',
      'renders/bad.png,academy-of-arcane-gastronomy,unknown,broken,png',
      'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,png',
    ].join('\n'),
  );

  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const summary = await runUpload({
      sourceDir,
      dryRun: true,
      force: false,
    });

    expect(summary).toMatchObject({ total: 2, planned: 1, failed: 1 });
  } finally {
    consoleError.mockRestore();
  }
});
