import { EMBEDDING_MAX_INPUT_CHARS } from '../../../../shared/embedding-limits';

/**
 * Lore Keeper Service
 *
 * Provides access to canonical campaign lore for starter campaigns.
 * This service wraps the database queries and embedding generation
 * so Franz (AI DM) can query campaign lore without MCP protocol overhead.
 *
 * For external tools/clients, use the Lore Keeper MCP server instead.
 */

import {
  CHUNK_COLUMNS,
  RULE_COLUMNS,
  CAMPAIGN_COLUMNS,
  type ChunkType,
  type StarterCampaign,
  type CampaignChunk,
  type CampaignRule,
  type SearchResult,
  mapCampaignRow,
  mapChunkRow,
  mapRuleRow,
} from './data-mapping';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Re-export types for backward compatibility
export type { ChunkType, StarterCampaign, CampaignChunk, CampaignRule, SearchResult };

/**
 * Lore Keeper Service for querying canonical campaign lore
 */
export class LoreKeeperService {
  constructor(_googleApiKey?: string) {}

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

    return (data || []).map(mapCampaignRow);
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

    return mapCampaignRow(data);
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

    return (data || []).map(mapChunkRow);
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

    return (data || []).map(mapRuleRow);
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

      const chunk = mapChunkRow(row);

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

      return (data || []).map((row: Record<string, unknown> & { similarity: number }) => ({
        ...mapChunkRow(row),
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

    return (data || []).map(mapChunkRow);
  }

  /**
   * Check if a session is using a starter campaign
   */
  async isStarterCampaignSession(sessionId: string): Promise<{
    isStarter: boolean;
    campaignId?: string;
    campaignVersion?: number;
  }> {
    let data: Record<string, unknown>;
    try {
      data = await userDataApi.getSession(sessionId);
    } catch {
      return { isStarter: false };
    }
    if (!data?.starter_campaign_id) {
      return { isStarter: false };
    }

    return {
      isStarter: true,
      campaignId: data.starter_campaign_id as string,
      campaignVersion: data.campaign_version as number | undefined,
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

    return mapChunkRow(data);
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    // Gemini text-embedding-004 produces 768-dimensional vectors
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const apiBase = import.meta.env.VITE_API_URL || '';
    const response = await fetch(`${apiBase}/v1/ai-proxy/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ text: text.substring(0, EMBEDDING_MAX_INPUT_CHARS) }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding generation failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.embedding;
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
