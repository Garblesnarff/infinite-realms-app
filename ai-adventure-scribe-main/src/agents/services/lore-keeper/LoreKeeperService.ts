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
  private openaiApiKey?: string;

  constructor(openaiApiKey?: string) {
    this.openaiApiKey = openaiApiKey || import.meta.env.VITE_OPENAI_API_KEY;
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
        'id, slug, title, tagline, genre, tone, difficulty, level_range, estimated_sessions, premise, is_complete, is_published, cover_image_url'
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
      .select('*')
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
      .select('*')
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
      .select('*')
      .eq('campaign_id', campaignId)
      .order('priority', { ascending: false });

    if (error) {
      logger.error('[LoreKeeper] Failed to get rules:', error);
      return [];
    }

    return (data || []).map(this.mapRuleRow);
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
    }
  ): Promise<SearchResult[]> {
    if (!this.openaiApiKey) {
      logger.warn('[LoreKeeper] No OpenAI API key - semantic search unavailable');
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
      .select('*')
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
    chunkTypes: ChunkType[]
  ): Promise<CampaignChunk | null> {
    const { data, error } = await supabase
      .from('campaign_chunks')
      .select('*')
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
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000), // Truncate for safety
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
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
