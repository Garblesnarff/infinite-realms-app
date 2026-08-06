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
  mapCampaignRow,
  mapChunkRow,
  mapRuleRow,
} from './data-mapping';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

// Re-export types for backward compatibility
export type { ChunkType, StarterCampaign, CampaignChunk, CampaignRule };

/**
 * Lore Keeper Service for querying canonical campaign lore
 */
export class LoreKeeperService {
  constructor(_googleApiKey?: string) {}

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
   * Get all canonical entities and deliverable handouts for prompt injection.
   * Returns deduplicated list with full content for each entity
   */
  async getEntities(campaignId: string): Promise<{
    npcs: CampaignChunk[];
    locations: CampaignChunk[];
    factions: CampaignChunk[];
    items: CampaignChunk[];
    monsters: CampaignChunk[];
    handouts: CampaignChunk[];
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
        'handout',
        'monster',
      ])
      .order('chunk_type')
      .order('entity_name');

    if (error) {
      logger.error('[LoreKeeper] Failed to get entities:', error);
      return { npcs: [], locations: [], factions: [], items: [], monsters: [], handouts: [] };
    }

    // ⚡ Bolt: Optimized to deduplicate, map, and group entities in a single O(N) pass.
    // This replaces multiple redundant filter/map iterations (O(7N)) with one efficient loop.
    const entities = {
      npcs: [] as CampaignChunk[],
      locations: [] as CampaignChunk[],
      factions: [] as CampaignChunk[],
      items: [] as CampaignChunk[],
      monsters: [] as CampaignChunk[],
      handouts: [] as CampaignChunk[],
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
      } else if (chunk.chunkType === 'handout') {
        entities.handouts.push(chunk);
      } else if (chunk.chunkType === 'monster') {
        entities.monsters.push(chunk);
      }
    }

    return entities;
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
