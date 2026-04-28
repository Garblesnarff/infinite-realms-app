/**
 * Lore Keeper Service
 *
 * Provides access to canonical campaign lore for starter campaigns.
 * This service wraps the database queries and embedding generation
 * so Franz (AI DM) can query campaign lore without MCP protocol overhead.
 *
 * For external tools/clients, use the Lore Keeper MCP server instead.
 */

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

// Explicit column lists to avoid over-fetching large vector embeddings
const CHUNK_COLUMNS =
  'id, campaign_id, chunk_type, entity_name, parent_entity, content, summary, metadata, sequence_order';
const RULE_COLUMNS = 'id, campaign_id, rule_type, condition, effect, reversible, priority';
const CAMPAIGN_COLUMNS =
  'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, creative_brief, overview, is_complete, is_published, cover_image_url';

// Types
export type ChunkType =
  | 'creative_brief'
  | 'world_building'
  | 'faction'
  | 'npc_tier1'
  | 'npc_tier2'
  | 'npc_tier3'
  | 'location'
  | 'quest_main'
  | 'quest_side'
  | 'mechanic'
  | 'item'
  | 'encounter'
  | 'session_outline';

export interface StarterCampaign {
  id: string;
  slug: string;
  title: string;
  tagline?: string;
  genre: string[];
  tone: string[];
  difficulty: string;
  levelRange?: string;
  estimatedSessions?: string;
  premise: string;
  creativeBrief?: string;
  overview?: string;
  isComplete: boolean;
  isPublished: boolean;
  coverImageUrl?: string;
}

export interface CampaignChunk {
  id: string;
  campaignId: string;
  chunkType: ChunkType;
  entityName?: string;
  parentEntity?: string;
  content: string;
  summary?: string;
  metadata: Record<string, unknown>;
  sequenceOrder?: number;
}

export interface CampaignRule {
  id: string;
  campaignId: string;
  ruleType: 'causality' | 'mechanic' | 'world_law';
  condition: string;
  effect: string;
  reversible: boolean;
  priority: number;
}

export interface SearchResult extends CampaignChunk {
  similarity: number;
}

/**
 * Lore Keeper Service for querying canonical campaign lore
 */
export class LoreKeeperService {
  private googleApiKey?: string;

  constructor(googleApiKey?: string) {
    this.googleApiKey = googleApiKey || import.meta.env.VITE_GOOGLE_AI_API_KEY;
  }

  /**
   * List available starter campaigns
   */
  async listCampaigns(filters?: {
    genre?: string;
    difficulty?: string;
  }): Promise<StarterCampaign[]> {
    let query = supabase
      .from('starter_campaigns')
      .select(
        'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, is_complete, is_published, cover_image_url',
      )
      .eq('is_published', true)
      .eq('is_complete', true);

    if (filters?.genre) {
      query = query.contains('genre', [filters.genre.toLowerCase()]);
    }

    if (filters?.difficulty) {
      query = query.eq('difficulty', filters.difficulty);
    }

    const { data, error } = await query.order('title');

    if (error) {
      logger.error('[LoreKeeper] Failed to list campaigns:', error);
      return [];
    }

    return (data || []).map(this.mapCampaignRow);
  }

  /**
   * Get full campaign overview
   */
  async getCampaignOverview(campaignId: string): Promise<StarterCampaign | null> {
    const { data, error } = await supabase
      .from('starter_campaigns')
      .select(CAMPAIGN_COLUMNS)
      .eq('id', campaignId)
      .eq('is_published', true)
      .eq('is_complete', true)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        logger.error('[LoreKeeper] Failed to get campaign:', error);
      }
      return null;
    }

    return this.mapCampaignRow(data);
  }

  /**
   * Get NPC by name
   */
  async getNPC(campaignId: string, name: string): Promise<CampaignChunk | null> {
    return this.getEntityByName(campaignId, name, ['npc_tier1', 'npc_tier2', 'npc_tier3']);
  }

  /**
   * Get location by name
   */
  async getLocation(campaignId: string, name: string): Promise<CampaignChunk | null> {
    return this.getEntityByName(campaignId, name, ['location']);
  }

  /**
   * Get faction by name
   */
  async getFaction(campaignId: string, name: string): Promise<CampaignChunk | null> {
    return this.getEntityByName(campaignId, name, ['faction']);
  }

  /**
   * Get all mechanics for a campaign
   */
  async getMechanics(campaignId: string): Promise<CampaignChunk[]> {
    const { data, error } = await supabase
      .from('campaign_chunks')
      .select(CHUNK_COLUMNS)
      .eq('campaign_id', campaignId)
      .eq('chunk_type', 'mechanic')
      .order('entity_name');

    if (error) {
      logger.error('[LoreKeeper] Failed to get mechanics:', error);
      return [];
    }

    return (data || []).map(this.mapChunkRow);
  }

  /**
   * Get causality rules for a campaign
   */
  async getRules(campaignId: string): Promise<CampaignRule[]> {
    const { data, error } = await supabase
      .from('campaign_rules')
      .select(RULE_COLUMNS)
      .eq('campaign_id', campaignId)
      .order('priority', { ascending: false });

    if (error) {
      logger.error('[LoreKeeper] Failed to get rules:', error);
      return [];
    }

    return (data || []).map(this.mapRuleRow);
  }

  /**
   * Get all canonical entities (NPCs, locations, factions, items, monsters) for prompt injection
   * Returns deduplicated list with full content for each entity
   */
  async getEntities(campaignId: string): Promise<{
    npcs: CampaignChunk[];
    locations: CampaignChunk[];
    factions: CampaignChunk[];
    items: CampaignChunk[];
    monsters: CampaignChunk[];
  }> {
    const { data, error } = await supabase
      .from('campaign_chunks')
      .select(CHUNK_COLUMNS)
      .eq('campaign_id', campaignId)
      .in('chunk_type', [
        'npc_tier1',
        'npc_tier2',
        'npc_tier3',
        'location',
        'faction',
        'item',
        'monster',
      ])
      .order('chunk_type')
      .order('entity_name');

    if (error) {
      logger.error('[LoreKeeper] Failed to get entities:', error);
      return { npcs: [], locations: [], factions: [], items: [], monsters: [] };
    }

    // ⚡ Bolt: Optimized to deduplicate, map, and group entities in a single O(N) pass.
    // This replaces multiple redundant filter/map iterations (O(7N)) with one efficient loop.
    const entities = {
      npcs: [] as CampaignChunk[],
      locations: [] as CampaignChunk[],
      factions: [] as CampaignChunk[],
      items: [] as CampaignChunk[],
      monsters: [] as CampaignChunk[],
    };

    const seenNames = new Set<string>();

    for (const row of data || []) {
      if (!row.entity_name || seenNames.has(row.entity_name)) continue;
      seenNames.add(row.entity_name);

      const chunk = this.mapChunkRow(row);

      if (['npc_tier1', 'npc_tier2', 'npc_tier3'].includes(chunk.chunkType)) {
        entities.npcs.push(chunk);
      } else if (chunk.chunkType === 'location') {
        entities.locations.push(chunk);
      } else if (chunk.chunkType === 'faction') {
        entities.factions.push(chunk);
      } else if (chunk.chunkType === 'item') {
        entities.items.push(chunk);
      } else if (chunk.chunkType === 'monster') {
        entities.monsters.push(chunk);
      }
    }

    return entities;
  }

  /**
   * Semantic search across campaign lore
   */
  async searchLore(
    campaignId: string,
    query: string,
    options?: {
      chunkTypes?: ChunkType[];
      limit?: number;
    },
  ): Promise<SearchResult[]> {
    if (!this.googleApiKey) {
      logger.warn('[LoreKeeper] No Google AI API key - semantic search unavailable');
      return [];
    }

    try {
      // Generate embedding for query
      const embedding = await this.generateEmbedding(query);

      // Use RPC function for vector search
      const { data, error } = await supabase.rpc('search_campaign_lore', {
        p_campaign_id: campaignId,
        p_query_embedding: `[${embedding.join(',')}]`,
        p_chunk_types: options?.chunkTypes || null,
        p_limit: options?.limit || 5,
        p_threshold: 0.7,
      });

      if (error) {
        logger.error('[LoreKeeper] Search failed:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        ...this.mapChunkRow(row),
        similarity: row.similarity,
      }));
    } catch (error) {
      logger.error('[LoreKeeper] Search error:', error);
      return [];
    }
  }

  /**
   * Get creative direction for a campaign (for image/voice generation)
   */
  async getCreativeDirection(campaignId: string): Promise<string | null> {
    const campaign = await this.getCampaignOverview(campaignId);
    return campaign?.creativeBrief || null;
  }

  /**
   * Get session outline for a campaign
   */
  async getSessionOutlines(campaignId: string): Promise<CampaignChunk[]> {
    const { data, error } = await supabase
      .from('campaign_chunks')
      .select(CHUNK_COLUMNS)
      .eq('campaign_id', campaignId)
      .eq('chunk_type', 'session_outline')
      .order('sequence_order');

    if (error) {
      logger.error('[LoreKeeper] Failed to get session outlines:', error);
      return [];
    }

    return (data || []).map(this.mapChunkRow);
  }

  /**
   * Check if a session is using a starter campaign
   */
  async isStarterCampaignSession(sessionId: string): Promise<{
    isStarter: boolean;
    campaignId?: string;
    campaignVersion?: number;
  }> {
    const { data, error } = await supabase
      .from('game_sessions')
      .select('starter_campaign_id, campaign_version')
      .eq('id', sessionId)
      .single();

    if (error || !data?.starter_campaign_id) {
      return { isStarter: false };
    }

    return {
      isStarter: true,
      campaignId: data.starter_campaign_id,
      campaignVersion: data.campaign_version,
    };
  }

  // Private helpers

  private async getEntityByName(
    campaignId: string,
    name: string,
    chunkTypes: ChunkType[],
  ): Promise<CampaignChunk | null> {
    const { data, error } = await supabase
      .from('campaign_chunks')
      .select(CHUNK_COLUMNS)
      .eq('campaign_id', campaignId)
      .ilike('entity_name', name)
      .in('chunk_type', chunkTypes)
      .limit(1)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        logger.error('[LoreKeeper] Failed to get entity:', error);
      }
      return null;
    }

    return this.mapChunkRow(data);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Gemini text-embedding-004 produces 768-dimensional vectors
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${this.googleApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: {
            parts: [{ text: text.substring(0, 8000) }], // Truncate for safety
          },
          taskType: 'RETRIEVAL_QUERY',
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini embedding generation failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.embedding.values;
  }

  private mapCampaignRow(row: any): StarterCampaign {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      tagline: row.tagline,
      genre: row.genre,
      tone: row.tone,
      difficulty: row.difficulty,
      levelRange: row.level_range,
      estimatedSessions: row.estimated_sessions,
      premise: row.premise,
      creativeBrief: row.creative_brief,
      overview: row.overview,
      isComplete: row.is_complete,
      isPublished: row.is_published,
      coverImageUrl: row.cover_image_url,
    };
  }

  private mapChunkRow(row: any): CampaignChunk {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      chunkType: row.chunk_type,
      entityName: row.entity_name,
      parentEntity: row.parent_entity,
      content: row.content,
      summary: row.summary,
      metadata: row.metadata || {},
      sequenceOrder: row.sequence_order,
    };
  }

  private mapRuleRow(row: any): CampaignRule {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      ruleType: row.rule_type,
      condition: row.condition,
      effect: row.effect,
      reversible: row.reversible,
      priority: row.priority,
    };
  }
}

// Singleton instance
let loreKeeperInstance: LoreKeeperService | null = null;

export function getLoreKeeperService(): LoreKeeperService {
  if (!loreKeeperInstance) {
    loreKeeperInstance = new LoreKeeperService();
  }
  return loreKeeperInstance;
}
