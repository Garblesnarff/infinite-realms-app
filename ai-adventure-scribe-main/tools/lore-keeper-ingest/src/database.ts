/**
 * Database operations for Lore Keeper ingestion
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CampaignChunk, CampaignRule, ParsedCampaign } from './types.js';

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
 * Insert campaign chunks in batches
 */
export async function insertCampaignChunks(
  chunks: CampaignChunk[],
  embeddings: (number[] | null)[] = []
): Promise<number> {
  const client = getClient();

  // Prepare data with embeddings
  const chunksWithEmbeddings = chunks.map((chunk, i) => ({
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

  // Insert in batches of 50
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < chunksWithEmbeddings.length; i += batchSize) {
    const batch = chunksWithEmbeddings.slice(i, i + batchSize);

    const { error } = await client.from('campaign_chunks').insert(batch);

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
