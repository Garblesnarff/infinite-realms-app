import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildCampaignAsset,
  findLinkTargets,
  getDatabaseTarget,
  nearestRealSlugs,
  normalizeAssetType,
  normalizeImageExtension,
  parseCliArgs,
  parseManifestCsv,
  runCheckLinks,
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
      checkLinks: false,
    });
    expect(parseCliArgs(['/tmp/assets', '--apply', '--force'])).toEqual({
      sourceDir: '/tmp/assets',
      dryRun: false,
      force: true,
      checkLinks: false,
    });
    expect(parseCliArgs(['/tmp/assets', '--check-links'])).toEqual({
      sourceDir: '/tmp/assets',
      dryRun: true,
      force: false,
      checkLinks: true,
    });
    expect(() => parseCliArgs(['/tmp/assets', '--apply', '--check-links'])).toThrow(
      'Cannot combine --apply with --check-links',
    );
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

interface MockRowFixtures {
  campaigns: Array<{ id: string; slug: string }>;
  chunks: Array<{
    id: string;
    campaign_id: string;
    chunk_type: string;
    entity_name: string | null;
    metadata?: unknown;
  }>;
  templates: Array<{
    id: string;
    starter_campaign_id: string;
    template_key: string;
    name: string;
  }>;
}

/**
 * A Supabase client that serves the read paths runCheckLinks uses and blows up
 * on any write path, proving the mode is read-only.
 */
function makeReadOnlyMockClient(fixtures: MockRowFixtures): {
  client: SupabaseClient;
  update: ReturnType<typeof vi.fn>;
  upload: ReturnType<typeof vi.fn>;
} {
  const update = vi.fn(() => {
    throw new Error('DB write attempted during --check-links');
  });
  const upload = vi.fn(() => {
    throw new Error('Storage write attempted during --check-links');
  });
  const storage = {
    from: vi.fn(() => ({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload,
    })),
  };
  const from = vi.fn((table: string) => {
    if (table === 'starter_campaigns') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((_column: string, value: unknown) => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: fixtures.campaigns.find((campaign) => campaign.slug === value) ?? null,
            error: null,
          }),
        })),
        update,
      };
    }
    const rows: Array<Record<string, unknown>> =
      table === 'campaign_chunks' ? fixtures.chunks : fixtures.templates;
    const idColumn = table === 'campaign_chunks' ? 'campaign_id' : 'starter_campaign_id';
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((_column: string, value: unknown) =>
        Promise.resolve({ data: rows.filter((row) => row[idColumn] === value), error: null }),
      ),
      update,
    };
  });
  return {
    client: { storage, from } as unknown as SupabaseClient,
    update,
    upload,
  };
}

async function writeLinksManifest(sourceDir: string, rows: string[]): Promise<void> {
  await mkdir(join(sourceDir, '_manifest'), { recursive: true });
  await writeFile(
    join(sourceDir, '_manifest', 'asset-upload-manifest.csv'),
    ['file path,campaign slug,type,entity slug,real image format', ...rows].join('\n'),
  );
}

function captureConsole(): {
  logLines: string[];
  errorLines: string[];
  restore: () => void;
} {
  const logLines: string[] = [];
  const errorLines: string[] = [];
  const consoleLog = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => logLines.push(args.map(String).join(' ')));
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation((...args: unknown[]) => errorLines.push(args.map(String).join(' ')));
  return {
    logLines,
    errorLines,
    restore() {
      consoleLog.mockRestore();
      consoleError.mockRestore();
    },
  };
}

describe('upload-campaign-assets --check-links', () => {
  const fixtures: MockRowFixtures = {
    campaigns: [{ id: 'campaign-1', slug: 'academy-of-arcane-gastronomy' }],
    chunks: [
      {
        id: 'chunk-1',
        campaign_id: 'campaign-1',
        chunk_type: 'npc_tier1',
        entity_name: 'Chef',
        metadata: { source: 'bible' },
      },
      {
        id: 'chunk-2',
        campaign_id: 'campaign-1',
        chunk_type: 'npc_tier1',
        entity_name: 'Empyrea',
        metadata: { source: 'bible' },
      },
    ],
    templates: [
      {
        id: 'template-1',
        starter_campaign_id: 'campaign-1',
        template_key: 'the-apprentice',
        name: 'The Apprentice',
      },
    ],
  };

  it('runs the real matcher without any storage or DB write', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-links-'));
    await writeLinksManifest(sourceDir, [
      'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,png',
      'renders/card.png,academy-of-arcane-gastronomy,card,cover,png',
      'renders/apprentice.png,academy-of-arcane-gastronomy,portrait,the-apprentice,png',
    ]);

    const { client, update, upload } = makeReadOnlyMockClient(fixtures);
    const { logLines, restore } = captureConsole();
    try {
      const summary = await runCheckLinks({ sourceDir, client });
      expect(summary).toEqual({
        total: 3,
        linked: 3,
        noMatch: 0,
        campaignNotFound: 0,
        failed: 0,
      });
    } finally {
      restore();
    }

    expect(update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(logLines).toContain('LINK academy-of-arcane-gastronomy/npc/chef → 1 row');
    expect(logLines).toContain('LINK academy-of-arcane-gastronomy/card/cover → 1 row');
    expect(logLines).toContain('LINK academy-of-arcane-gastronomy/portrait/the-apprentice → 1 row');
  });

  it('reports NO MATCH with hint slugs for a parenthetical-style miss', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-links-'));
    await writeLinksManifest(sourceDir, [
      'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,png',
      'renders/empyrea.png,academy-of-arcane-gastronomy,npc,empyrea-light,png',
    ]);

    const { client, update, upload } = makeReadOnlyMockClient(fixtures);
    const { logLines, errorLines, restore } = captureConsole();
    try {
      const summary = await runCheckLinks({ sourceDir, client });
      expect(summary).toEqual({
        total: 2,
        linked: 1,
        noMatch: 1,
        campaignNotFound: 0,
        failed: 0,
      });
    } finally {
      restore();
    }

    expect(update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(logLines).toContain('LINK academy-of-arcane-gastronomy/npc/chef → 1 row');
    expect(errorLines).toContain('NO MATCH academy-of-arcane-gastronomy/npc/empyrea-light');
    expect(errorLines.some((line) => line.includes('No campaign_chunks row for'))).toBe(true);
    expect(errorLines).toContain('  hint: empyrea');
  });

  it('counts rows whose campaign row is missing separately', async () => {
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-links-'));
    await writeLinksManifest(sourceDir, ['renders/chef.png,retired-campaign,npc,chef,png']);

    const { client } = makeReadOnlyMockClient(fixtures);
    const { errorLines, restore } = captureConsole();
    try {
      const summary = await runCheckLinks({ sourceDir, client });
      expect(summary).toEqual({
        total: 1,
        linked: 0,
        noMatch: 0,
        campaignNotFound: 1,
        failed: 0,
      });
    } finally {
      restore();
    }

    expect(errorLines).toContain('NO MATCH retired-campaign/npc/chef');
    // No hints are possible when the campaign itself is missing.
    expect(errorLines.some((line) => line.startsWith('  hint:'))).toBe(false);
  });

  it('reports the same per-row link count --apply would link', async () => {
    // One slug matching two chunks: --apply links both rows, --check-links
    // must print "→ 2 rows" for the same manifest row.
    const sourceDir = await mkdtemp(join(tmpdir(), 'campaign-asset-links-'));
    await writeLinksManifest(sourceDir, [
      'renders/chef.png,academy-of-arcane-gastronomy,npc,chef,png',
    ]);

    const twoChefFixtures: MockRowFixtures = {
      ...fixtures,
      chunks: [
        ...fixtures.chunks.filter((chunk) => chunk.entity_name !== 'Empyrea'),
        {
          id: 'chunk-2',
          campaign_id: 'campaign-1',
          chunk_type: 'npc_tier2',
          entity_name: 'Chef',
          metadata: {},
        },
      ],
    };

    const { client, update, upload } = makeReadOnlyMockClient(twoChefFixtures);
    const { logLines, restore } = captureConsole();
    try {
      const summary = await runCheckLinks({ sourceDir, client });
      expect(summary).toEqual({
        total: 1,
        linked: 1,
        noMatch: 0,
        campaignNotFound: 0,
        failed: 0,
      });
    } finally {
      restore();
    }
    expect(logLines).toContain('LINK academy-of-arcane-gastronomy/npc/chef → 2 rows');
    expect(update).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();

    // Same fixture under --apply: linkAsset (shared matcher) links both rows.
    const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
    const applyStorage = {
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      upload: vi.fn().mockResolvedValue({ error: null }),
    };
    const applyClient = {
      storage: { from: vi.fn(() => applyStorage) },
      from: vi.fn((table: string) => {
        if (table === 'starter_campaigns') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: twoChefFixtures.campaigns[0],
                error: null,
              }),
            })),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: twoChefFixtures.chunks, error: null }),
          update: vi.fn((values: Record<string, unknown>) => ({
            eq: vi.fn().mockImplementation(async () => {
              updates.push({ table, values });
              return { error: null };
            }),
          })),
        };
      }),
    } as unknown as SupabaseClient;

    await mkdir(join(sourceDir, 'renders'), { recursive: true });
    await writeFile(join(sourceDir, 'renders', 'chef.png'), 'fake image');
    const uploadSummary = await runUpload({
      sourceDir,
      dryRun: false,
      force: true,
      supabaseUrl: 'https://test.supabase.co',
      client: applyClient,
    });
    expect(uploadSummary).toMatchObject({ total: 1, linked: 2, failed: 0 });
    expect(updates).toHaveLength(2);
  });

  it('shares one matcher: findLinkTargets throws the same no-match errors', () => {
    const asset = {
      filePath: 'renders/ghost.png',
      campaignSlug: 'academy-of-arcane-gastronomy',
      type: 'npc' as const,
      entitySlug: 'ghost',
      realImageFormat: 'png',
    };
    const campaign = { id: 'campaign-1', slug: 'academy-of-arcane-gastronomy' };
    expect(() => findLinkTargets(asset, campaign, [])).toThrow(
      'No campaign_chunks row for academy-of-arcane-gastronomy/npc/ghost',
    );
    expect(
      findLinkTargets({ ...asset, entitySlug: 'chef' }, campaign, fixtures.chunks.slice(0, 1)),
    ).toHaveLength(1);
  });

  it('suggests the nearest real slugs without ever auto-fallbacking', () => {
    const hints = nearestRealSlugs(['chef', 'empyrea', 'puck'], 'empyrea-light');
    expect(hints[0]).toBe('empyrea');
    expect(hints).toHaveLength(3);
    expect(nearestRealSlugs([], 'empyrea-light')).toEqual([]);
    expect(nearestRealSlugs(['a', 'a', 'a'], 'b')).toEqual(['a']);
  });
});
