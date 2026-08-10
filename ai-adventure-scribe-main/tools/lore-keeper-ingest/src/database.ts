/**
 * Database operations for Lore Keeper ingestion
 */

import { createClient } from '@supabase/supabase-js';

import type { CampaignChunk, CampaignRule, ParsedCampaign } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

/**
 * Initialize Supabase client with service role key (for full access)
 */
export function initSupabase(url: string, serviceRoleKey: string): void {
  supabase = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Get the Supabase client
 */
function getClient(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase client not initialized. Call initSupabase first.');
  }
  return supabase;
}

/**
 * Upsert a starter campaign
 */
export async function upsertStarterCampaign(
  campaign: ParsedCampaign & {
    isComplete: boolean;
    isPublished: boolean;
  }
): Promise<void> {
  const client = getClient();

  const { error } = await client
    .from('starter_campaigns')
    .upsert(
      {
        id: campaign.id,
        slug: campaign.slug,
        title: campaign.title,
        tagline: campaign.tagline,
        genre: campaign.genre,
        sub_genre: campaign.subGenre,
        tone: campaign.tone,
        difficulty: campaign.difficulty,
        level_range: campaign.levelRange,
        estimated_sessions: campaign.estimatedSessions,
        premise: campaign.premise,
        creative_brief: campaign.creativeBrief,
        overview: campaign.overview,
        is_complete: campaign.isComplete,
        is_published: campaign.isPublished,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) {
    throw new Error(`Failed to upsert campaign ${campaign.id}: ${error.message}`);
  }
}

/**
 * Delete all chunks for a campaign (before re-ingestion)
 */
export async function deleteCampaignChunks(campaignId: string): Promise<number> {
  const client = getClient();

  const { data, error } = await client
    .from('campaign_chunks')
    .delete()
    .eq('campaign_id', campaignId)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete chunks for ${campaignId}: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Delete all rules for a campaign (before re-ingestion)
 */
export async function deleteCampaignRules(campaignId: string): Promise<number> {
  const client = getClient();

  const { data, error } = await client
    .from('campaign_rules')
    .delete()
    .eq('campaign_id', campaignId)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete rules for ${campaignId}: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Row shape as sent to campaign_chunks (snake_case, matches the table).
 */
interface CampaignChunkRow {
  campaign_id: string;
  chunk_type: string;
  entity_name: string | null | undefined;
  parent_entity: string | null | undefined;
  content: string;
  summary: string | null | undefined;
  embedding: string | null;
  metadata: Record<string, unknown>;
  source_file: string;
  source_section: string | null | undefined;
  sequence_order: number | null | undefined;
}

/**
 * True if a chunk's metadata carries a non-empty image_url.
 * Mirrors the keep-rule in
 * supabase/migrations/20260810_dedupe_campaign_chunks.sql so the ingest path
 * and the one-off dedupe migration agree on which duplicate row wins.
 */
function hasImageUrl(metadata: Record<string, unknown> | null | undefined): boolean {
  const value = metadata?.image_url;
  return typeof value === 'string' && value.length > 0;
}

/**
 * Collapse chunks that would collide on the (campaign_id, chunk_type,
 * entity_name) unique index before they're sent to the database.
 *
 * The chunker can occasionally emit two chunks for the same entity within a
 * single run (e.g. an NPC matched by both the primary numbered-list
 * extractor and the bonus table-format extractor in chunker.ts). Sending
 * both rows in the same upsert batch would make Postgres reject the batch
 * with "ON CONFLICT DO UPDATE command cannot affect row a second time"
 * instead of silently duplicating — which is safer, but would still break
 * ingestion. Pre-deduping here, using the same "prefer image_url, else keep
 * first" rule as the migration, avoids that failure entirely.
 *
 * Rows with a null/undefined entity_name (whole-file chunks like
 * `world_building`/`creative_brief`) are passed through untouched: the
 * unique index does not apply to them (NULL is never equal to NULL in a
 * Postgres unique index), so they can never conflict.
 */
function dedupeChunkRows(rows: CampaignChunkRow[]): CampaignChunkRow[] {
  const passthrough: CampaignChunkRow[] = [];
  const byKey = new Map<string, CampaignChunkRow>();

  for (const row of rows) {
    if (row.entity_name == null) {
      passthrough.push(row);
      continue;
    }

    const key = `${row.campaign_id} ${row.chunk_type} ${row.entity_name}`;
    const existing = byKey.get(key);

    if (!existing || (hasImageUrl(row.metadata) && !hasImageUrl(existing.metadata))) {
      byKey.set(key, row);
    }
  }

  return [...passthrough, ...byKey.values()];
}

/**
 * Insert campaign chunks in batches.
 *
 * Uses upsert-on-conflict against the (campaign_id, chunk_type, entity_name)
 * unique index added by
 * supabase/migrations/20260810_dedupe_campaign_chunks.sql, per #1664's
 * acceptance criteria ("seed/import path handles conflict gracefully -
 * upsert, not insert"). `deleteCampaignChunks` is still called before this in
 * index.ts for a full campaign re-ingest; the upsert here is defense in depth
 * for any row-level write path that doesn't go through that delete-first
 * flow.
 */
export async function insertCampaignChunks(
  chunks: CampaignChunk[],
  embeddings: (number[] | null)[] = []
): Promise<number> {
  const client = getClient();

  // Prepare data with embeddings
  const chunksWithEmbeddings: CampaignChunkRow[] = chunks.map((chunk, i) => ({
    campaign_id: chunk.campaignId,
    chunk_type: chunk.chunkType,
    entity_name: chunk.entityName,
    parent_entity: chunk.parentEntity,
    content: chunk.content,
    summary: chunk.summary,
    embedding: embeddings[i] ? formatEmbedding(embeddings[i]!) : null,
    metadata: chunk.metadata,
    source_file: chunk.sourceFile,
    source_section: chunk.sourceSection,
    sequence_order: chunk.sequenceOrder,
  }));

  const deduped = dedupeChunkRows(chunksWithEmbeddings);

  // Insert in batches of 50
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);

    const { error } = await client
      .from('campaign_chunks')
      .upsert(batch, { onConflict: 'campaign_id,chunk_type,entity_name' });

    if (error) {
      throw new Error(`Failed to insert chunks batch ${i}: ${error.message}`);
    }

    inserted += batch.length;
  }

  return inserted;
}

/**
 * Insert campaign rules
 */
export async function insertCampaignRules(rules: CampaignRule[]): Promise<number> {
  if (rules.length === 0) return 0;

  const client = getClient();

  const rulesData = rules.map(rule => ({
    campaign_id: rule.campaignId,
    rule_type: rule.ruleType,
    condition: rule.condition,
    effect: rule.effect,
    reversible: rule.reversible,
    priority: rule.priority,
    metadata: rule.metadata,
  }));

  const { error } = await client.from('campaign_rules').insert(rulesData);

  if (error) {
    throw new Error(`Failed to insert rules: ${error.message}`);
  }

  return rules.length;
}

/**
 * Get a starter campaign by ID
 */
export async function getStarterCampaign(
  campaignId: string
): Promise<ParsedCampaign | null> {
  const client = getClient();

  const { data, error } = await client
    .from('starter_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw new Error(`Failed to get campaign ${campaignId}: ${error.message}`);
  }

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    tagline: data.tagline,
    genre: data.genre,
    subGenre: data.sub_genre,
    tone: data.tone,
    difficulty: data.difficulty,
    levelRange: data.level_range,
    estimatedSessions: data.estimated_sessions,
    premise: data.premise,
    creativeBrief: data.creative_brief,
    overview: data.overview,
  };
}

/**
 * List all starter campaigns
 */
export async function listStarterCampaigns(): Promise<
  Array<{ id: string; title: string; isComplete: boolean; isPublished: boolean }>
> {
  const client = getClient();

  const { data, error } = await client
    .from('starter_campaigns')
    .select('id, title, is_complete, is_published')
    .order('title');

  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }

  return (data || []).map(c => ({
    id: c.id,
    title: c.title,
    isComplete: c.is_complete,
    isPublished: c.is_published,
  }));
}

/**
 * Update campaign version
 */
export async function incrementCampaignVersion(campaignId: string): Promise<number> {
  const client = getClient();

  const { data, error } = await client
    .from('starter_campaigns')
    .select('current_version')
    .eq('id', campaignId)
    .single();

  if (error) {
    throw new Error(`Failed to get version for ${campaignId}: ${error.message}`);
  }

  const newVersion = (data.current_version || 0) + 1;

  const { error: updateError } = await client
    .from('starter_campaigns')
    .update({ current_version: newVersion, updated_at: new Date().toISOString() })
    .eq('id', campaignId);

  if (updateError) {
    throw new Error(`Failed to update version for ${campaignId}: ${updateError.message}`);
  }

  return newVersion;
}

/**
 * Format embedding array for Postgres vector type
 */
function formatEmbedding(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  const client = getClient();

  try {
    const { error } = await client.from('starter_campaigns').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}
