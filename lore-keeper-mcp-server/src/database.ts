/**
 * Database operations for Lore Keeper MCP Server
 *
 * Stateless - every request queries Supabase fresh.
 * No in-memory caching - makes horizontal scaling trivial.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { clients } from './clients.js';
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
 * Initializes the Supabase and OpenAI clients. This must be called once
 * at application startup before any other database functions are used.
 *
 * @param supabaseUrl - The URL of the Supabase project.
 * @param supabaseKey - The service role key for Supabase.
 * @param openaiKey - The API key for OpenAI, required for semantic search.
 * @example
 * ```typescript
 * import { initialize } from './database';
 *
 * initialize(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, process.env.OPENAI_KEY);
 * ```
 */
export function initialize(
  supabaseUrl: string,
  supabaseKey: string,
  openaiKey?: string
): void {
  supabase = clients.createSupabaseClient(supabaseUrl, supabaseKey);

  if (openaiKey) {
    openai = clients.createOpenAIClient({ apiKey: openaiKey });
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
 * Lists available starter campaigns, optionally filtering by genre, difficulty, or featured status.
 * Only returns campaigns that are marked as published and complete.
 *
 * @param filters - An optional object to filter the campaigns.
 * @param filters.genre - Filter campaigns by a specific genre (e.g., "fantasy").
 * @param filters.difficulty - Filter campaigns by difficulty level (e.g., "medium").
 * @param filters.featured - If true, only return featured campaigns.
 * @returns A promise that resolves to an array of starter campaigns.
 * @example
 * ```typescript
 * const fantasyCampaigns = await listCampaigns({ genre: 'fantasy' });
 * console.log(fantasyCampaigns);
 * ```
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
 * Retrieves the full overview of a specific campaign, including its creative brief and other metadata.
 *
 * @param campaignId - The unique identifier for the campaign.
 * @returns A promise that resolves to the campaign object, or null if not found.
 * @example
 * ```typescript
 * const campaign = await getCampaignOverview('a_midsummer_nights_chaos');
 * if (campaign) {
 *   console.log(campaign.title);
 * }
 * ```
 */
export async function getCampaignOverview(campaignId: string): Promise<StarterCampaign | null> {
  const client = getClient();

  // ⚡ Bolt: Replaced select('*') with an explicit column list to reduce over-fetching.
  // This is a database performance best practice.
  const { data, error } = await client
    .from('starter_campaigns')
    .select(
      'id, slug, title, tagline, genre, sub_genre, tone, difficulty, level_range, estimated_sessions, premise, creative_brief, overview, is_complete, is_published, is_featured, cover_image_url'
    )
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
 * Retrieves a specific NPC from a campaign by their name (case-insensitive).
 *
 * @param campaignId - The identifier for the campaign.
 * @param name - The name of the NPC to retrieve.
 * @returns A promise that resolves to the NPC chunk, or null if not found.
 * @example
 * ```typescript
 * const npc = await getNPC('a_midsummer_nights_chaos', 'Puck');
 * console.log(npc?.content);
 * ```
 */
export async function getNPC(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['npc_tier1', 'npc_tier2', 'npc_tier3']);
}

/**
 * Retrieves a specific location from a campaign by its name (case-insensitive).
 *
 * @param campaignId - The identifier for the campaign.
 * @param name - The name of the location to retrieve.
 * @returns A promise that resolves to the location chunk, or null if not found.
 * @example
 * ```typescript
 * const location = await getLocation('a_midsummer_nights_chaos', 'The Feywild');
 * console.log(location?.summary);
 * ```
 */
export async function getLocation(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['location']);
}

/**
 * Retrieves a specific faction from a campaign by its name (case-insensitive).
 *
 * @param campaignId - The identifier for the campaign.
 * @param name - The name of the faction to retrieve.
 * @returns A promise that resolves to the faction chunk, or null if not found.
 * @example
 * ```typescript
 * const faction = await getFaction('a_midsummer_nights_chaos', 'The Seelie Court');
 * console.log(faction?.metadata);
 * ```
 */
export async function getFaction(
  campaignId: string,
  name: string
): Promise<CampaignChunk | null> {
  return getEntityByName(campaignId, name, ['faction']);
}

/**
 * Retrieves all unique game mechanics for a specific campaign.
 *
 * @param campaignId - The identifier for the campaign.
 * @returns A promise that resolves to an array of mechanic chunks.
 * @example
 * ```typescript
 * const mechanics = await getMechanics('a_midsummer_nights_chaos');
 * mechanics.forEach(mechanic => console.log(mechanic.entityName));
 * ```
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
 * Retrieves all causality rules (IF/THEN logic) for a specific campaign.
 * These rules help the AI DM enforce world consequences.
 *
 * @param campaignId - The identifier for the campaign.
 * @returns A promise that resolves to an array of campaign rules.
 * @example
 * ```typescript
 * const rules = await getRules('a_midsummer_nights_chaos');
 * console.log(rules);
 * ```
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
  if (!name) {
    return null;
  }
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
 * Performs a semantic search across the lore of a specific campaign using a natural language query.
 * Requires the OpenAI key to be initialized.
 *
 * @param campaignId - The identifier for the campaign to search within.
 * @param query - The natural language query to search for.
 * @param options - Optional parameters to refine the search.
 * @param options.chunkTypes - An array of chunk types to restrict the search to.
 * @param options.limit - The maximum number of results to return (default: 5).
 * @param options.threshold - The similarity threshold for results (default: 0.7).
 * @returns A promise that resolves to an array of search results, including similarity scores.
 * @example
 * ```typescript
 * const results = await searchLore(
 *   'a_midsummer_nights_chaos',
 *   'who is the queen of the fairies?',
 *   { limit: 3 }
 * );
 * console.log(results);
 * ```
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
 * Retrieves a list of pre-built starter parties for a specific campaign.
 *
 * @param campaignId - The identifier for the campaign.
 * @returns A promise that resolves to an array of campaign parties.
 * @example
 * ```typescript
 * const parties = await getStarterParties('a_midsummer_nights_chaos');
 * console.log(parties.map(p => p.partyName));
 * ```
 */
export async function getStarterParties(campaignId: string): Promise<CampaignParty[]> {
  const client = getClient();

  // ⚡ Bolt: Replaced select('*') with an explicit column list to reduce over-fetching.
  const { data, error } = await client
    .from('campaign_parties')
    .select(
      'id, campaign_id, party_name, party_concept, party_hook, playstyle, is_default'
    )
    .eq('campaign_id', campaignId)
    .order('is_default', { ascending: false })
    .order('party_name');

  if (error) {
    throw new Error(`Failed to get parties: ${error.message}`);
  }

  return (data || []).map(mapPartyRow);
}

/**
 * Retrieves the full details for a specific party, including the party concept and
 * a list of all its characters with their backstories and stats.
 *
 * @param partyId - The unique identifier for the party.
 * @returns A promise that resolves to an object containing party and character details, or null if not found.
 * @example
 * ```typescript
 * const partyDetails = await getPartyDetails('some-party-uuid');
 * if (partyDetails) {
 *   console.log(partyDetails.party.partyName);
 *   console.log(partyDetails.characters);
 * }
 * ```
 */
export async function getPartyDetails(partyId: string): Promise<{
  party: CampaignParty;
  characters: PartyCharacter[];
} | null> {
  const client = getClient();

  // ⚡ Bolt: Combined party and character queries into a single nested query
  // to eliminate the N+1 problem. This reduces database round trips from 2 to 1.
  const { data, error } = await client
    .from('campaign_parties')
    .select('*, party_characters(*)')
    .eq('id', partyId)
    .order('character_name', { foreignTable: 'party_characters' })
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to get party details: ${error.message}`);
  }

  // The nested query returns characters as a property on the party object.
  // We need to extract them and map them separately.
  const { party_characters: charactersData, ...partyData } = data;

  return {
    party: mapPartyRow(partyData),
    characters: (charactersData || []).map(mapCharacterRow),
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
