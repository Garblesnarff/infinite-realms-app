#!/usr/bin/env bun
/* eslint-disable max-lines, no-console */
/**
 * Upload the assets reconciled in _manifest/asset-upload-manifest.csv.
 *
 * The manifest is the source of truth for the local file, campaign, entity,
 * asset type, and real image format. The command is intentionally a dry run
 * unless --apply is supplied.
 *
 * Usage:
 *   bun scripts/upload-campaign-assets.ts <source-dir>
 *   bun scripts/upload-campaign-assets.ts <source-dir> --apply
 *   bun scripts/upload-campaign-assets.ts <source-dir> --apply --force
 *   bun scripts/upload-campaign-assets.ts <source-dir> --campaign=abyssal-descent
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

export const BUCKET_NAME = 'campaign-images';
export const MANIFEST_PATH = join('_manifest', 'asset-upload-manifest.csv');

const PUBLIC_STORAGE_PATH = '/storage/v1/object/public';

export type CampaignAssetType =
  | 'npc'
  | 'monster'
  | 'location'
  | 'item'
  | 'scene'
  | 'card'
  | 'banner'
  | 'portrait';

export interface ManifestAsset {
  filePath: string;
  campaignSlug: string;
  type: CampaignAssetType;
  entitySlug: string;
  realImageFormat: string;
}

export interface CampaignAsset extends ManifestAsset {
  localPath: string;
  storagePath: string;
  publicUrl: string;
}

export interface CliOptions {
  sourceDir: string | null;
  campaignFilter?: string;
  dryRun: boolean;
  force: boolean;
}

export interface UploadSummary {
  total: number;
  planned: number;
  uploaded: number;
  skipped: number;
  linked: number;
  failed: number;
}

interface CampaignRow {
  id: string;
  slug: string;
}

interface ChunkRow {
  id: string;
  campaign_id: string;
  chunk_type: string;
  entity_name: string | null;
  metadata: unknown;
}

interface CharacterTemplateRow {
  id: string;
  starter_campaign_id: string;
  template_key: string;
  name: string;
}

interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

interface DatabaseTarget {
  table: 'campaign_chunks' | 'starter_campaigns' | 'starter_character_templates';
  column: 'metadata.image_url' | 'cover_image_url' | 'banner_image_url' | 'portrait_url';
}

interface RunOptions {
  sourceDir: string;
  dryRun: boolean;
  force: boolean;
  campaignFilter?: string;
  supabaseUrl?: string;
  client?: SupabaseClient;
}

const TYPE_ALIASES: Record<string, CampaignAssetType> = {
  npc: 'npc',
  monster: 'monster',
  location: 'location',
  item: 'item',
  scene: 'scene',
  card: 'card',
  banner: 'banner',
  portrait: 'portrait',
  portraits: 'portrait',
  character: 'portrait',
};

const FORMAT_ALIASES: Record<string, string> = {
  avif: 'avif',
  gif: 'gif',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  jpeg: 'jpg',
  jpg: 'jpg',
  png: 'png',
  svg: 'svg',
  webp: 'webp',
};

const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

const CHUNK_TYPES_BY_ASSET_TYPE: Record<
  Extract<CampaignAssetType, 'npc' | 'monster' | 'location' | 'item' | 'scene'>,
  string[]
> = {
  npc: ['npc_tier1', 'npc_tier2', 'npc_tier3'],
  monster: ['monster', 'encounter'],
  location: ['location'],
  item: ['item'],
  // The current enum has no dedicated scene value. Keep the aliases here so
  // manifests can link scene art to the scene-like chunks already in the DB.
  scene: ['scene', 'encounter', 'session_outline'],
};

const USAGE = `Usage: bun scripts/upload-campaign-assets.ts <source-dir> [--apply] [--force] [--campaign=<slug>]`;

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Parse RFC 4180-style CSV, including quoted commas and escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim().length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error('Manifest CSV contains an unterminated quoted field');

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim().length > 0)) rows.push(row);
  }

  return rows;
}

function getRequiredColumnIndex(headers: string[], aliases: string[], label: string): number {
  const normalizedHeaders = headers.map(normalizeHeader);
  const index = normalizedHeaders.findIndex((header) =>
    aliases.some((alias) => header === normalizeHeader(alias)),
  );

  if (index === -1) {
    throw new Error(`Manifest is missing the required "${label}" column`);
  }

  return index;
}

function normalizeManifestSlug(value: string, label: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`Manifest ${label} must be a kebab-case slug: "${value}"`);
  }
  return slug;
}

export function normalizeAssetType(value: string): CampaignAssetType {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
  const type = TYPE_ALIASES[normalized];
  if (!type) {
    throw new Error(
      `Unsupported asset type "${value}"; expected npc, monster, location, item, scene, card, banner, or portrait`,
    );
  }
  return type;
}

export function normalizeImageExtension(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/^\./, '');
  const extension = FORMAT_ALIASES[normalized];
  if (!extension) {
    throw new Error(`Unsupported real image format "${value}"`);
  }
  return extension;
}

/** Parse the reconciliation manifest into validated, canonical rows. */
export function parseManifestCsv(text: string): ManifestAsset[] {
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw new Error('Manifest CSV must contain a header and at least one asset row');

  const headers = rows[0];
  const filePathIndex = getRequiredColumnIndex(
    headers,
    ['file path', 'file_path', 'path'],
    'file path',
  );
  const campaignSlugIndex = getRequiredColumnIndex(
    headers,
    ['campaign slug', 'campaign_slug', 'campaign'],
    'campaign slug',
  );
  const typeIndex = getRequiredColumnIndex(headers, ['type', 'asset type', 'asset_type'], 'type');
  const entitySlugIndex = getRequiredColumnIndex(
    headers,
    ['entity slug', 'entity_slug', 'entity'],
    'entity slug',
  );
  const realFormatIndex = getRequiredColumnIndex(
    headers,
    [
      'real image format',
      'real_image_format',
      'real format',
      'real_format',
      'real ext',
      'real_ext',
      'extension',
    ],
    'real image format',
  );

  return rows.slice(1).map((row, rowIndex) => {
    const manifestLine = rowIndex + 2;
    const filePath = row[filePathIndex]?.trim();
    const campaignSlug = row[campaignSlugIndex]?.trim();
    const type = row[typeIndex]?.trim();
    const entitySlug = row[entitySlugIndex]?.trim();
    const realImageFormat = row[realFormatIndex]?.trim();

    if (!filePath || !campaignSlug || !type || !entitySlug || !realImageFormat) {
      throw new Error(`Manifest row ${manifestLine} has an empty required field`);
    }

    return {
      filePath,
      campaignSlug: normalizeManifestSlug(campaignSlug, 'campaign slug'),
      type: normalizeAssetType(type),
      entitySlug: normalizeManifestSlug(entitySlug, 'entity slug'),
      realImageFormat: normalizeImageExtension(realImageFormat),
    };
  });
}

export function getDatabaseTarget(type: CampaignAssetType): DatabaseTarget {
  if (type === 'card') {
    return { table: 'starter_campaigns', column: 'cover_image_url' };
  }
  if (type === 'banner') {
    return { table: 'starter_campaigns', column: 'banner_image_url' };
  }
  if (type === 'portrait') {
    return { table: 'starter_character_templates', column: 'portrait_url' };
  }
  return { table: 'campaign_chunks', column: 'metadata.image_url' };
}

function assertPathWithinSource(sourceDir: string, filePath: string): string {
  const sourceRoot = resolve(sourceDir);
  const localPath = resolve(sourceRoot, filePath);
  const relativePath = relative(sourceRoot, localPath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Manifest file path escapes the source directory: "${filePath}"`);
  }
  return localPath;
}

function publicStorageUrl(supabaseUrl: string, storagePath: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}${PUBLIC_STORAGE_PATH}/${BUCKET_NAME}/${storagePath}`;
}

export function buildCampaignAsset(
  manifestAsset: ManifestAsset,
  sourceDir: string,
  supabaseUrl = 'https://example.supabase.co',
): CampaignAsset {
  const localPath = assertPathWithinSource(sourceDir, manifestAsset.filePath);
  const storagePath = [
    'starter',
    manifestAsset.campaignSlug,
    manifestAsset.type,
    `${manifestAsset.entitySlug}.${manifestAsset.realImageFormat}`,
  ].join('/');

  return {
    ...manifestAsset,
    localPath,
    storagePath,
    publicUrl: publicStorageUrl(supabaseUrl, storagePath),
  };
}

export function parseCliArgs(argv: string[]): CliOptions {
  let sourceDir: string | null = null;
  let campaignFilter: string | undefined;
  let force = false;
  let apply = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      if (sourceDir) throw new Error(`Unexpected positional argument: ${argument}`);
      sourceDir = argument;
      continue;
    }

    if (argument === '--force') {
      force = true;
    } else if (argument === '--apply' || argument === '--no-dry-run') {
      apply = true;
    } else if (argument === '--dry-run') {
      apply = false;
    } else if (argument.startsWith('--campaign=')) {
      campaignFilter = normalizeManifestSlug(
        argument.slice('--campaign='.length),
        'campaign filter',
      );
    } else if (argument === '--campaign') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--campaign requires a slug');
      campaignFilter = normalizeManifestSlug(next, 'campaign filter');
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return { sourceDir, campaignFilter, dryRun: !apply, force };
}

export function getSupabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceRoleKey = env[`SUPABASE_${'SERVICE_ROLE_KEY'}`];
  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase URL or service-role credential');
  }
  return { url, serviceRoleKey };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

function slugForLookup(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function findCampaign(client: SupabaseClient, campaignSlug: string): Promise<CampaignRow> {
  const { data, error } = await client
    .from('starter_campaigns')
    .select('id, slug')
    .eq('slug', campaignSlug)
    .maybeSingle();

  if (error) throw new Error(`Could not find campaign "${campaignSlug}": ${errorMessage(error)}`);
  if (!data) throw new Error(`No starter_campaigns row exists for slug "${campaignSlug}"`);

  return data as CampaignRow;
}

async function findChunks(client: SupabaseClient, campaignId: string): Promise<ChunkRow[]> {
  const { data, error } = await client
    .from('campaign_chunks')
    .select('id, campaign_id, chunk_type, entity_name, metadata')
    .eq('campaign_id', campaignId);

  if (error)
    throw new Error(`Could not read campaign_chunks for "${campaignId}": ${errorMessage(error)}`);
  return (data || []) as ChunkRow[];
}

async function findCharacterTemplates(
  client: SupabaseClient,
  campaignId: string,
): Promise<CharacterTemplateRow[]> {
  const { data, error } = await client
    .from('starter_character_templates')
    .select('id, starter_campaign_id, template_key, name')
    .eq('starter_campaign_id', campaignId);

  if (error) {
    throw new Error(
      `Could not read starter_character_templates for "${campaignId}": ${errorMessage(error)}`,
    );
  }
  return (data || []) as CharacterTemplateRow[];
}

function chunkMatchesAssetType(chunk: ChunkRow, type: CampaignAssetType): boolean {
  if (type === 'card' || type === 'banner' || type === 'portrait') return false;
  return CHUNK_TYPES_BY_ASSET_TYPE[type].includes(chunk.chunk_type);
}

function metadataWithImageUrl(metadata: unknown, publicUrl: string): Record<string, unknown> {
  const existing =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return { ...existing, image_url: publicUrl };
}

async function linkAsset(
  client: SupabaseClient,
  asset: CampaignAsset,
  campaign: CampaignRow,
  chunks: ChunkRow[] | undefined,
  templates: CharacterTemplateRow[] | undefined,
): Promise<number> {
  if (asset.type === 'card' || asset.type === 'banner') {
    const column = asset.type === 'card' ? 'cover_image_url' : 'banner_image_url';
    const { error } = await client
      .from('starter_campaigns')
      .update({ [column]: asset.publicUrl })
      .eq('id', campaign.id);
    if (error) throw new Error(`Could not update ${column}: ${errorMessage(error)}`);
    return 1;
  }

  if (asset.type === 'portrait') {
    const matches = (templates || []).filter(
      (template) =>
        slugForLookup(template.template_key) === asset.entitySlug ||
        slugForLookup(template.name) === asset.entitySlug,
    );
    if (matches.length === 0) {
      throw new Error(
        `No starter_character_templates row for ${campaign.slug}/${asset.entitySlug}`,
      );
    }

    for (const template of matches) {
      const { error } = await client
        .from('starter_character_templates')
        .update({ portrait_url: asset.publicUrl })
        .eq('id', template.id);
      if (error) {
        throw new Error(
          `Could not update portrait_url for ${template.name}: ${errorMessage(error)}`,
        );
      }
    }
    return matches.length;
  }

  const matches = (chunks || []).filter(
    (chunk) =>
      chunkMatchesAssetType(chunk, asset.type) &&
      chunk.entity_name !== null &&
      slugForLookup(chunk.entity_name) === asset.entitySlug,
  );
  if (matches.length === 0) {
    throw new Error(
      `No campaign_chunks row for ${campaign.slug}/${asset.type}/${asset.entitySlug}`,
    );
  }

  for (const chunk of matches) {
    const { error } = await client
      .from('campaign_chunks')
      .update({ metadata: metadataWithImageUrl(chunk.metadata, asset.publicUrl) })
      .eq('id', chunk.id);
    if (error) {
      throw new Error(
        `Could not update image_url for ${chunk.entity_name}: ${errorMessage(error)}`,
      );
    }
  }
  return matches.length;
}

async function storageObjectExists(
  storage: ReturnType<SupabaseClient['storage']['from']>,
  storagePath: string,
): Promise<boolean> {
  const fileName = basename(storagePath);
  const parentPath = dirname(storagePath) === '.' ? '' : dirname(storagePath);
  const { data, error } = await storage.list(parentPath, { limit: 1000, search: fileName });
  if (error) throw new Error(`Could not check storage for ${storagePath}: ${errorMessage(error)}`);
  return (data || []).some((entry) => entry.name === fileName);
}

async function uploadObject(
  storage: ReturnType<SupabaseClient['storage']['from']>,
  asset: CampaignAsset,
): Promise<void> {
  const contentType = CONTENT_TYPES[asset.realImageFormat];
  const fileContent = await readFile(asset.localPath);
  const { error } = await storage.upload(asset.storagePath, fileContent, {
    cacheControl: '31536000',
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Could not upload ${asset.storagePath}: ${errorMessage(error)}`);
}

export async function runUpload(options: RunOptions): Promise<UploadSummary> {
  const sourceDir = resolve(options.sourceDir);
  const manifestPath = join(sourceDir, MANIFEST_PATH);
  const manifestText = await readFile(manifestPath, 'utf8');
  const manifest = parseManifestCsv(manifestText).filter(
    (asset) => !options.campaignFilter || asset.campaignSlug === options.campaignFilter,
  );

  if (manifest.length === 0) {
    throw new Error(
      options.campaignFilter
        ? `No manifest rows found for campaign "${options.campaignFilter}"`
        : `No assets found in ${manifestPath}`,
    );
  }

  if (!options.dryRun && (!options.client || !options.supabaseUrl)) {
    throw new Error('An authenticated Supabase client and URL are required with --apply');
  }

  const summary: UploadSummary = {
    total: manifest.length,
    planned: 0,
    uploaded: 0,
    skipped: 0,
    linked: 0,
    failed: 0,
  };
  const campaignCache = new Map<string, CampaignRow>();
  const chunkCache = new Map<string, ChunkRow[]>();
  const templateCache = new Map<string, CharacterTemplateRow[]>();
  const storage = options.client?.storage.from(BUCKET_NAME);

  for (const manifestAsset of manifest) {
    const asset = buildCampaignAsset(manifestAsset, sourceDir, options.supabaseUrl);
    try {
      const fileStats = await stat(asset.localPath);
      if (!fileStats.isFile())
        throw new Error(`Manifest path is not a file: ${manifestAsset.filePath}`);

      const target = getDatabaseTarget(asset.type);
      if (options.dryRun) {
        console.log(`Would upload ${asset.localPath} -> ${asset.storagePath}`);
        console.log(`  Would set ${target.table}.${target.column} -> ${asset.publicUrl}`);
        summary.planned += 1;
        continue;
      }

      if (!options.client || !storage) {
        throw new Error(
          'An authenticated Supabase client and storage handle are required with --apply',
        );
      }
      const client = options.client;
      const campaign =
        campaignCache.get(asset.campaignSlug) || (await findCampaign(client, asset.campaignSlug));
      campaignCache.set(asset.campaignSlug, campaign);

      const alreadyUploaded =
        !options.force && (await storageObjectExists(storage, asset.storagePath));
      if (alreadyUploaded) {
        console.log(`Skipped existing object: ${asset.storagePath}`);
        summary.skipped += 1;
      } else {
        await uploadObject(storage, asset);
        console.log(`Uploaded: ${asset.storagePath}`);
        summary.uploaded += 1;
      }

      if (asset.type !== 'card' && asset.type !== 'banner' && asset.type !== 'portrait') {
        if (!chunkCache.has(campaign.id))
          chunkCache.set(campaign.id, await findChunks(client, campaign.id));
      }
      if (asset.type === 'portrait' && !templateCache.has(campaign.id)) {
        templateCache.set(campaign.id, await findCharacterTemplates(client, campaign.id));
      }

      const linked = await linkAsset(
        client,
        asset,
        campaign,
        chunkCache.get(campaign.id),
        templateCache.get(campaign.id),
      );
      console.log(
        `Linked ${asset.type}/${asset.entitySlug} (${linked} row${linked === 1 ? '' : 's'})`,
      );
      summary.linked += linked;
    } catch (error) {
      summary.failed += 1;
      console.error(`Failed ${manifestAsset.filePath}: ${errorMessage(error)}`);
    }
  }

  return summary;
}

function printSummary(summary: UploadSummary, dryRun: boolean): void {
  console.log('\nAsset upload summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Assets: ${summary.total}`);
  console.log(`  Planned: ${summary.planned}`);
  console.log(`  Uploaded: ${summary.uploaded}`);
  console.log(`  Skipped existing: ${summary.skipped}`);
  console.log(`  Linked DB rows: ${summary.linked}`);
  console.log(`  Failed: ${summary.failed}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (!options.sourceDir) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  try {
    const supabaseConfig = options.dryRun ? undefined : getSupabaseConfig();
    const summary = await runUpload({
      sourceDir: options.sourceDir,
      dryRun: options.dryRun,
      force: options.force,
      campaignFilter: options.campaignFilter,
      supabaseUrl: supabaseConfig?.url,
      client: supabaseConfig
        ? createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey)
        : undefined,
    });
    printSummary(summary, options.dryRun);
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(errorMessage(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
