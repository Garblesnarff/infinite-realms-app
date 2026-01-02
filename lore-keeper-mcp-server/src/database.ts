/**
 * Database operations for Lore Keeper MCP Server
 *
 * Stateless - every request queries Supabase fresh.
 * No in-memory caching - makes horizontal scaling trivial.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import type {
  StarterCampaign,
  CampaignChunk,
  CampaignRule,
  CampaignParty,
  PartyCharacter,
  ChunkType,
  SearchResult,
} from './types.js';

let supabase: SupabaseClient | null = null;
let openai: OpenAI | null = null;

/**
 * Initialize database and embedding clients
 */
export function initialize(
  supabaseUrl: string,
  supabaseKey: string,
  openaiKey?: string
): void {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  if (openaiKey) {
    openai = new OpenAI({ apiKey: openaiKey });
  }
}

function getClient(): SupabaseClient {
  if (!supabase) {
    throw new Error('Database not initialized');
  }
  return supabase;
}

// =============================================================================
// CAMPAIGN DISCOVERY
// =============================================================================

/**
 * List available campaigns with optional filters
 */
export async function listCampaigns(filters?: {
  genre?: string;
  difficulty?: string;
  featured?: boolean;
}): Promise<StarterCampaign[]> {
  const client = getClient();

  let query = client
    .from('starter_campaigns')
    .select(
      'id, slug, title, tagline, genre, sub_genre, tone, difficulty, level_range, estimated_sessions, premise, is_complete, is_published, is_featured, cover_image_url'
    )
    .eq('is_published', true)
    .eq('is_complete', true);

  if (filters?.genre) {
    query = query.contains('genre', [filters.genre.toLowerCase()]);
  }

  if (filters?.difficulty) {
    query = query.eq('difficulty', filters.difficulty);
  }

  if (filters?.featured) {
    query = query.eq('is_featured', true);
  }

  const { data, error } = await query.order('title');

  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }

  return (data || []).map(mapCampaignRow);
}

/**
 * Get full campaign overview including creative brief
 */
export async function getCampaignOverview(campaignId: string): Promise<StarterCampaign | null> {
  const client = getClient();

  const { data, error } = await client
    .from('starter_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('is_published', true)
    .eq('is_complete', true)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get campaign: ${error.message}`);
  }

  return mapCampaignRow(data);
}

// =============================================================================
// LORE RETRIEVAL - DIRECT LOOKUP
// =============================================================================

/**
 * Get NPC by name (case-insensitive)
 */
export async function getNPC(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['npc_tier1', 'npc_tier2', 'npc_tier3']);
}

/**
 * Get location by name
 */
export async function getLocation(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['location']);
}

/**
 * Get faction by name
 */
export async function getFaction(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['faction']);
}

/**
 * Get all mechanics for a campaign
 */
export async function getMechanics(campaignId: string): Promise<CampaignChunk[]> {
  const client = getClient();

  const { data, error } = await client
    .from('campaign_chunks')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('chunk_type', 'mechanic')
    .order('entity_name');

  if (error) {
    throw new Error(`Failed to get mechanics: ${error.message}`);
  }

  return (data || []).map(mapChunkRow);
}

/**
 * Get causality rules for a campaign
 */
export async function getRules(campaignId: string): Promise<CampaignRule[]> {
  const client = getClient();

  const { data, error } = await client
    .from('campaign_rules')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('priority', { ascending: false });

  if (error) {
    throw new Error(`Failed to get rules: ${error.message}`);
  }

  return (data || []).map(mapRuleRow);
}

/**
 * Generic entity lookup by name
 */
async function getEntityByName(
  campaignId: string,
  name: string,
  chunkTypes: ChunkType[]
): Promise<CampaignChunk | null> {
  const client = getClient();

  // Use the RPC function for case-insensitive lookup
  const { data, error } = await client.rpc('get_campaign_entity', {
    p_campaign_id: campaignId,
    p_entity_name: name,
    p_chunk_type: chunkTypes.length === 1 ? chunkTypes[0] : null,
  });

  if (error) {
    // Fallback to direct query if RPC fails
    const { data: fallbackData, error: fallbackError } = await client
      .from('campaign_chunks')
      .select('*')
      .eq('campaign_id', campaignId)
      .ilike('entity_name', name)
      .in('chunk_type', chunkTypes)
      .limit(1)
      .single();

    if (fallbackError) {
      if (fallbackError.code === 'PGRST116') return null;
      throw new Error(`Failed to get entity: ${fallbackError.message}`);
    }

    return fallbackData ? mapChunkRow(fallbackData) : null;
  }

  return data && data.length > 0 ? mapChunkRow(data[0]) : null;
}

// =============================================================================
// LORE RETRIEVAL - SEMANTIC SEARCH
// =============================================================================

/**
 * Semantic search across campaign lore
 */
export async function searchLore(
  campaignId: string,
  query: string,
  options?: {
    chunkTypes?: ChunkType[];
    limit?: number;
    threshold?: number;
  }
): Promise<SearchResult[]> {
  if (!openai) {
    throw new Error('OpenAI not initialized - cannot perform semantic search');
  }

  const client = getClient();
  const limit = options?.limit ?? 5;
  const threshold = options?.threshold ?? 0.7;

  // Generate embedding for query
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const queryEmbedding = embeddingResponse.data[0].embedding;

  // Use RPC function for vector search
  const { data, error } = await client.rpc('search_campaign_lore', {
    p_campaign_id: campaignId,
    p_query_embedding: formatEmbedding(queryEmbedding),
    p_chunk_types: options?.chunkTypes ?? null,
    p_limit: limit,
    p_threshold: threshold,
  });

  if (error) {
    throw new Error(`Failed to search lore: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    ...mapChunkRow(row),
    similarity: row.similarity as number,
  }));
}

// =============================================================================
// PARTY ACCESS
// =============================================================================

/**
 * Get starter parties for a campaign
 */
export async function getStarterParties(campaignId: string): Promise<CampaignParty[]> {
  const client = getClient();

  const { data, error } = await client
    .from('campaign_parties')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('is_default', { ascending: false })
    .order('party_name');

  if (error) {
    throw new Error(`Failed to get parties: ${error.message}`);
  }

  return (data || []).map(mapPartyRow);
}

/**
 * Get party details including all characters
 */
export async function getPartyDetails(partyId: string): Promise<{
  party: CampaignParty;
  characters: PartyCharacter[];
} | null> {
  const client = getClient();

  // Get party
  const { data: partyData, error: partyError } = await client
    .from('campaign_parties')
    .select('*')
    .eq('id', partyId)
    .single();

  if (partyError) {
    if (partyError.code === 'PGRST116') return null;
    throw new Error(`Failed to get party: ${partyError.message}`);
  }

  // Get characters
  const { data: charData, error: charError } = await client
    .from('party_characters')
    .select('*')
    .eq('party_id', partyId)
    .order('character_name');

  if (charError) {
    throw new Error(`Failed to get characters: ${charError.message}`);
  }

  return {
    party: mapPartyRow(partyData),
    characters: (charData || []).map(mapCharacterRow),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function formatEmbedding(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function mapCampaignRow(row: Record<string, unknown>): StarterCampaign {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    tagline: row.tagline as string | undefined,
    genre: row.genre as string[],
    subGenre: row.sub_genre as string[] | undefined,
    tone: row.tone as string[],
    difficulty: row.difficulty as string,
    levelRange: row.level_range as string | undefined,
    estimatedSessions: row.estimated_sessions as string | undefined,
    premise: row.premise as string,
    creativeBrief: row.creative_brief as string | undefined,
    overview: row.overview as string | undefined,
    isComplete: row.is_complete as boolean,
    isPublished: row.is_published as boolean,
    isFeatured: row.is_featured as boolean,
    coverImageUrl: row.cover_image_url as string | undefined,
  };
}

function mapChunkRow(row: Record<string, unknown>): CampaignChunk {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    chunkType: row.chunk_type as ChunkType,
    entityName: row.entity_name as string | undefined,
    parentEntity: row.parent_entity as string | undefined,
    content: row.content as string,
    summary: row.summary as string | undefined,
    metadata: (row.metadata as Record<string, unknown>) || {},
    sourceFile: row.source_file as string | undefined,
    sourceSection: row.source_section as string | undefined,
    sequenceOrder: row.sequence_order as number | undefined,
  };
}

function mapRuleRow(row: Record<string, unknown>): CampaignRule {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    ruleType: row.rule_type as CampaignRule['ruleType'],
    condition: row.condition as string,
    effect: row.effect as string,
    reversible: row.reversible as boolean,
    priority: row.priority as number,
    metadata: (row.metadata as Record<string, unknown>) || {},
  };
}

function mapPartyRow(row: Record<string, unknown>): CampaignParty {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    partyName: row.party_name as string,
    partyConcept: row.party_concept as string,
    partyHook: row.party_hook as string,
    playstyle: row.playstyle as CampaignParty['playstyle'],
    isDefault: row.is_default as boolean,
  };
}

function mapCharacterRow(row: Record<string, unknown>): PartyCharacter {
  return {
    id: row.id as string,
    partyId: row.party_id as string,
    characterName: row.character_name as string,
    race: row.race as string,
    characterClass: row.class as string,
    level: row.level as number,
    backstory: row.backstory as string,
    personality: row.personality as string,
    campaignHook: row.campaign_hook as string,
    partyRelationship: row.party_relationship as string | undefined,
    stats: row.stats as PartyCharacter['stats'],
    portraitUrl: row.portrait_url as string | undefined,
  };
}
