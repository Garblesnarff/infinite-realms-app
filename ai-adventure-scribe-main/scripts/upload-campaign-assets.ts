#!/usr/bin/env bun
/* eslint-disable max-lines, no-console */
/**
 * Upload the assets reconciled in _manifest/asset-upload-manifest.csv.
 *
 * The manifest is the source of truth for the local file, campaign, entity,
 * asset type, and real image format. The command is intentionally a dry run
 * unless --apply is supplied.
 * Character-card manifest rows must use the starter template_key as the entity
 * slug; display names are not stable identifiers for this template-scoped asset.
 *
 * --check-links is a read-only mode that runs the real matching logic against
 * the database and writes nothing: no storage upload, no DB update. It needs
 * the same Supabase credentials as --apply. For each manifest row it prints
 * LINK <campaign>/<type>/<slug> -> N rows or NO MATCH <campaign>/<type>/<slug>
 * (with the nearest real slugs of that type as hints for a human — never an
 * automatic fallback), prints a summary, and exits non-zero when any row has
 * no match, so it can gate an art delivery before --apply.
 *
 * Usage:
 *   bun scripts/upload-campaign-assets.ts <source-dir>
 *   bun scripts/upload-campaign-assets.ts <source-dir> --apply
 *   bun scripts/upload-campaign-assets.ts <source-dir> --apply --force
 *   bun scripts/upload-campaign-assets.ts <source-dir> --campaign=abyssal-descent
 *   bun scripts/upload-campaign-assets.ts <source-dir> --check-links
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
  | 'faction'
  | 'scene'
  | 'card'
  | 'banner'
  | 'portrait'
  | 'character_card';

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
  checkLinks: boolean;
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
  column:
    | 'metadata.image_url'
    | 'cover_image_url'
    | 'banner_image_url'
    | 'portrait_url'
    | 'card_image_url';
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
  faction: 'faction',
  factions: 'faction',
  scene: 'scene',
  card: 'card',
  banner: 'banner',
  portrait: 'portrait',
  portraits: 'portrait',
  character: 'portrait',
  character_card: 'character_card',
  'character-card': 'character_card',
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
  Extract<CampaignAssetType, 'npc' | 'monster' | 'location' | 'item' | 'faction' | 'scene'>,
  string[]
> = {
  npc: ['npc_tier1', 'npc_tier2', 'npc_tier3'],
  monster: ['monster', 'encounter'],
  location: ['location'],
  item: ['item'],
  faction: ['faction'],
  // The current enum has no dedicated scene value. Keep the aliases here so
  // manifests can link scene art to the scene-like chunks already in the DB.
  scene: ['scene', 'encounter', 'session_outline'],
};

const USAGE = `Usage: bun scripts/upload-campaign-assets.ts <source-dir> [--apply] [--force] [--campaign=<slug>] [--check-links]`;

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
      `Unsupported asset type "${value}"; expected npc, monster, location, item, faction, scene, card, banner, portrait, or character_card`,
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
export function parseManifestCsv(
  text: string,
  campaignFilter?: string,
  onRowError?: (error: unknown, manifestLine: number) => void,
): ManifestAsset[] {
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw new Error('Manifest CSV must contain a header and at least one asset row');

  const headers = rows[0];
  const filePathIndex = getRequiredColumnIndex(
    headers,
    ['file path', 'file_path', 'path', 'source'],
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
    ['entity slug', 'entity_slug', 'entity', 'slug'],
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
      'format actual',
      'format_actual',
    ],
    'real image format',
  );

  const normalizedCampaignFilter = campaignFilter?.trim().toLowerCase();
  const selectedRows = rows.slice(1).flatMap((row, rowIndex) => {
    if (!normalizedCampaignFilter) return [{ row, manifestLine: rowIndex + 2 }];
    const rowCampaign = row[campaignSlugIndex]
      ?.trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    return rowCampaign === normalizedCampaignFilter ? [{ row, manifestLine: rowIndex + 2 }] : [];
  });

  return selectedRows.flatMap(({ row, manifestLine }) => {
    try {
      const filePath = row[filePathIndex]?.trim();
      const campaignSlug = row[campaignSlugIndex]?.trim();
      const type = row[typeIndex]?.trim();
      const entitySlug = row[entitySlugIndex]?.trim();
      const realImageFormat = row[realFormatIndex]?.trim();

      if (!filePath || !campaignSlug || !type || !entitySlug || !realImageFormat) {
        throw new Error(`Manifest row ${manifestLine} has an empty required field`);
      }

      return [
        {
          filePath,
          campaignSlug: normalizeManifestSlug(campaignSlug, 'campaign slug'),
          type: normalizeAssetType(type),
          entitySlug: normalizeManifestSlug(entitySlug, 'entity slug'),
          realImageFormat: normalizeImageExtension(realImageFormat),
        },
      ];
    } catch (error) {
      if (!onRowError) throw error;
      onRowError(error, manifestLine);
      return [];
    }
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
  if (type === 'character_card') {
    return { table: 'starter_character_templates', column: 'card_image_url' };
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
  let checkLinks = false;

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
    } else if (argument === '--check-links') {
      checkLinks = true;
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

  if (apply && checkLinks) {
    throw new Error('Cannot combine --apply with --check-links: check-links is read-only');
  }

  return { sourceDir, campaignFilter, dryRun: !apply, force, checkLinks };
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
  if (type === 'card' || type === 'banner' || type === 'portrait' || type === 'character_card') {
    return false;
  }
  return CHUNK_TYPES_BY_ASSET_TYPE[type].includes(chunk.chunk_type);
}

function metadataWithImageUrl(metadata: unknown, publicUrl: string): Record<string, unknown> {
  const existing =
    typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return { ...existing, image_url: publicUrl };
}

/** A database row that an asset would be linked to. Pure data: no client, no writes. */
export type LinkTarget =
  | { kind: 'chunk'; row: ChunkRow }
  | { kind: 'campaign'; row: CampaignRow }
  | { kind: 'template'; row: CharacterTemplateRow };

/** Which preloaded DB rows the matcher needs for an asset type. */
function linkDataKind(type: CampaignAssetType): 'chunks' | 'templates' | 'campaign' {
  if (type === 'card' || type === 'banner') return 'campaign';
  if (type === 'portrait' || type === 'character_card') return 'templates';
  return 'chunks';
}

/**
 * Pure matcher: given an asset, its campaign row, and the preloaded chunk /
 * template rows for that campaign, return the rows the asset would link to.
 * Throws the same no-match errors --apply relies on, so --check-links and
 * --apply share one matcher and cannot drift apart.
 */
export function findLinkTargets(
  asset: ManifestAsset,
  campaign: CampaignRow,
  chunks?: ChunkRow[],
  templates?: CharacterTemplateRow[],
): LinkTarget[] {
  if (asset.type === 'card' || asset.type === 'banner') {
    // The campaign row itself is the target; findCampaign already proved it exists.
    return [{ kind: 'campaign', row: campaign }];
  }

  if (asset.type === 'portrait' || asset.type === 'character_card') {
    const matches = (templates || []).filter((template) => {
      const templateKeyMatches = slugForLookup(template.template_key) === asset.entitySlug;
      // Character cards intentionally require template_key: names can collide across campaigns.
      if (asset.type === 'character_card') return templateKeyMatches;
      return templateKeyMatches || slugForLookup(template.name) === asset.entitySlug;
    });
    if (matches.length === 0) {
      throw new Error(
        `No starter_character_templates row for ${campaign.slug}/${asset.entitySlug}`,
      );
    }
    return matches.map((row) => ({ kind: 'template', row }) as const);
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
  return matches.map((row) => ({ kind: 'chunk', row }) as const);
}

async function linkAsset(
  client: SupabaseClient,
  asset: CampaignAsset,
  campaign: CampaignRow,
  chunks: ChunkRow[] | undefined,
  templates: CharacterTemplateRow[] | undefined,
): Promise<number> {
  const targets = findLinkTargets(asset, campaign, chunks, templates);

  for (const target of targets) {
    if (target.kind === 'campaign') {
      const column = asset.type === 'card' ? 'cover_image_url' : 'banner_image_url';
      const { error } = await client
        .from('starter_campaigns')
        .update({ [column]: asset.publicUrl })
        .eq('id', target.row.id);
      if (error) throw new Error(`Could not update ${column}: ${errorMessage(error)}`);
      continue;
    }

    if (target.kind === 'template') {
      const column = asset.type === 'portrait' ? 'portrait_url' : 'card_image_url';
      const { error } = await client
        .from('starter_character_templates')
        .update({ [column]: asset.publicUrl })
        .eq('id', target.row.id);
      if (error) {
        throw new Error(
          `Could not update ${column} for ${target.row.name}: ${errorMessage(error)}`,
        );
      }
      continue;
    }

    const { error } = await client
      .from('campaign_chunks')
      .update({ metadata: metadataWithImageUrl(target.row.metadata, asset.publicUrl) })
      .eq('id', target.row.id);
    if (error) {
      throw new Error(
        `Could not update image_url for ${target.row.entity_name}: ${errorMessage(error)}`,
      );
    }
  }

  return targets.length;
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

function levenshteinDistance(first: string, second: string): number {
  if (first === second) return 0;
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let row = 1; row <= first.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= second.length; column += 1) {
      const saved = previous[column];
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (first[row - 1] === second[column - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return previous[second.length];
}

/**
 * Nearest real slugs to a miss, for human hints only. Never an automatic
 * fallback: the caller prints these, the matcher never acts on them.
 */
export function nearestRealSlugs(candidates: string[], target: string, limit = 3): string[] {
  const unique = [...new Set(candidates)].filter((candidate) => candidate.length > 0);
  return unique
    .map((candidate) => ({ candidate, distance: levenshteinDistance(target, candidate) }))
    .sort(
      (first, second) =>
        first.distance - second.distance || first.candidate.localeCompare(second.candidate),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** Real slugs of the same type that a manifest slug failed to match, for hints. */
function candidateSlugsForHints(
  type: CampaignAssetType,
  chunks: ChunkRow[] | undefined,
  templates: CharacterTemplateRow[] | undefined,
): string[] {
  const linkData = linkDataKind(type);
  if (linkData === 'chunks') {
    return (chunks || []).flatMap((chunk) =>
      chunkMatchesAssetType(chunk, type) && chunk.entity_name !== null
        ? [slugForLookup(chunk.entity_name)]
        : [],
    );
  }
  if (linkData === 'templates') {
    return (templates || []).flatMap((template) => {
      const slugs = [slugForLookup(template.template_key)];
      if (type === 'portrait') slugs.push(slugForLookup(template.name));
      return slugs;
    });
  }
  return [];
}

export function isCampaignMissingError(error: unknown): boolean {
  return errorMessage(error).startsWith('No starter_campaigns row exists');
}

export interface CheckLinksOptions {
  sourceDir: string;
  campaignFilter?: string;
  /** Authenticated client; --check-links never calls update() or storage.upload(). */
  client: SupabaseClient;
}

export interface CheckLinksSummary {
  total: number;
  linked: number;
  noMatch: number;
  campaignNotFound: number;
  failed: number;
}

/**
 * Read-only link check: runs the same matcher --apply uses against the real
 * database and writes nothing. Prints LINK / NO MATCH per manifest row and a
 * summary; callers should exit non-zero when anything missed.
 */
export async function runCheckLinks(options: CheckLinksOptions): Promise<CheckLinksSummary> {
  const sourceDir = resolve(options.sourceDir);
  const manifestPath = join(sourceDir, MANIFEST_PATH);
  const manifestText = await readFile(manifestPath, 'utf8');
  const summary: CheckLinksSummary = {
    total: 0,
    linked: 0,
    noMatch: 0,
    campaignNotFound: 0,
    failed: 0,
  };
  const manifest = parseManifestCsv(manifestText, options.campaignFilter, (error, manifestLine) => {
    summary.failed += 1;
    console.error(`Failed manifest row ${manifestLine}: ${errorMessage(error)}`);
  });
  summary.total = manifest.length + summary.failed;

  if (summary.total === 0) {
    throw new Error(
      options.campaignFilter
        ? `No manifest rows found for campaign "${options.campaignFilter}"`
        : `No assets found in ${manifestPath}`,
    );
  }

  const client = options.client;
  const campaignCache = new Map<string, CampaignRow>();
  const chunkCache = new Map<string, ChunkRow[]>();
  const templateCache = new Map<string, CharacterTemplateRow[]>();

  for (const manifestAsset of manifest) {
    const label = `${manifestAsset.campaignSlug}/${manifestAsset.type}/${manifestAsset.entitySlug}`;
    try {
      const campaign =
        campaignCache.get(manifestAsset.campaignSlug) ||
        (await findCampaign(client, manifestAsset.campaignSlug));
      campaignCache.set(manifestAsset.campaignSlug, campaign);

      const linkData = linkDataKind(manifestAsset.type);
      if (linkData === 'chunks' && !chunkCache.has(campaign.id)) {
        chunkCache.set(campaign.id, await findChunks(client, campaign.id));
      }
      if (linkData === 'templates' && !templateCache.has(campaign.id)) {
        templateCache.set(campaign.id, await findCharacterTemplates(client, campaign.id));
      }

      const targets = findLinkTargets(
        manifestAsset,
        campaign,
        chunkCache.get(campaign.id),
        templateCache.get(campaign.id),
      );
      summary.linked += 1;
      console.log(`LINK ${label} → ${targets.length} row${targets.length === 1 ? '' : 's'}`);
    } catch (error) {
      if (isCampaignMissingError(error)) {
        summary.campaignNotFound += 1;
      } else {
        summary.noMatch += 1;
      }
      console.error(`NO MATCH ${label}`);
      console.error(`  ${errorMessage(error)}`);
      const campaign = campaignCache.get(manifestAsset.campaignSlug);
      if (campaign) {
        const hints = nearestRealSlugs(
          candidateSlugsForHints(
            manifestAsset.type,
            chunkCache.get(campaign.id),
            templateCache.get(campaign.id),
          ),
          manifestAsset.entitySlug,
        );
        for (const hint of hints) console.error(`  hint: ${hint}`);
      }
    }
  }

  return summary;
}

export async function runUpload(options: RunOptions): Promise<UploadSummary> {
  const sourceDir = resolve(options.sourceDir);
  const manifestPath = join(sourceDir, MANIFEST_PATH);
  const manifestText = await readFile(manifestPath, 'utf8');
  const summary: UploadSummary = {
    total: 0,
    planned: 0,
    uploaded: 0,
    skipped: 0,
    linked: 0,
    failed: 0,
  };
  const manifest = parseManifestCsv(manifestText, options.campaignFilter, (error, manifestLine) => {
    summary.failed += 1;
    console.error(`Failed manifest row ${manifestLine}: ${errorMessage(error)}`);
  });
  summary.total = manifest.length + summary.failed;

  if (summary.total === 0) {
    throw new Error(
      options.campaignFilter
        ? `No manifest rows found for campaign "${options.campaignFilter}"`
        : `No assets found in ${manifestPath}`,
    );
  }

  if (!options.dryRun && (!options.client || !options.supabaseUrl)) {
    throw new Error('An authenticated Supabase client and URL are required with --apply');
  }

  const campaignCache = new Map<string, CampaignRow>();
  const chunkCache = new Map<string, ChunkRow[]>();
  const templateCache = new Map<string, CharacterTemplateRow[]>();
  const storage = options.client?.storage.from(BUCKET_NAME);

  for (const manifestAsset of manifest) {
    try {
      const asset = buildCampaignAsset(manifestAsset, sourceDir, options.supabaseUrl);
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

      const linkData = linkDataKind(asset.type);
      if (linkData === 'chunks' && !chunkCache.has(campaign.id)) {
        chunkCache.set(campaign.id, await findChunks(client, campaign.id));
      }
      if (linkData === 'templates' && !templateCache.has(campaign.id)) {
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

function printCheckLinksSummary(summary: CheckLinksSummary): void {
  console.log('\nLink check summary');
  console.log('  Mode: CHECK LINKS (read-only, nothing written)');
  console.log(`  Assets: ${summary.total}`);
  console.log(`  Would link: ${summary.linked}`);
  console.log(`  No match: ${summary.noMatch}`);
  console.log(`  Campaign not found: ${summary.campaignNotFound}`);
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

  if (options.checkLinks) {
    try {
      const supabaseConfig = getSupabaseConfig();
      const summary = await runCheckLinks({
        sourceDir: options.sourceDir,
        campaignFilter: options.campaignFilter,
        client: createClient(supabaseConfig.url, supabaseConfig.serviceRoleKey),
      });
      printCheckLinksSummary(summary);
      if (summary.noMatch > 0 || summary.campaignNotFound > 0 || summary.failed > 0) {
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(errorMessage(error));
      process.exitCode = 1;
    }
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
