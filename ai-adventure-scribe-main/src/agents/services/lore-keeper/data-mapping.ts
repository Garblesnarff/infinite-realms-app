/**
 * Data mapping utilities and types for Lore Keeper Service
 * Extracted from LoreKeeperService.ts
 */

// Explicit column lists to avoid over-fetching large vector embeddings
export const CHUNK_COLUMNS =
  'id, campaign_id, chunk_type, entity_name, parent_entity, content, summary, metadata, sequence_order';
export const RULE_COLUMNS = 'id, campaign_id, rule_type, condition, effect, reversible, priority';
export const CAMPAIGN_COLUMNS =
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
 * Maps a database row to a StarterCampaign object
 */
export function mapCampaignRow(row: Record<string, unknown>): StarterCampaign {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    tagline: row.tagline as string,
    genre: row.genre as string[],
    tone: row.tone as string[],
    difficulty: row.difficulty as string,
    levelRange: row.level_range as string,
    estimatedSessions: row.estimated_sessions as string,
    premise: row.premise as string,
    creativeBrief: row.creative_brief as string,
    overview: row.overview as string,
    isComplete: row.is_complete as boolean,
    isPublished: row.is_published as boolean,
    coverImageUrl: row.cover_image_url as string,
  };
}

/**
 * Maps a database row to a CampaignChunk object
 */
export function mapChunkRow(row: Record<string, unknown>): CampaignChunk {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    chunkType: row.chunk_type as ChunkType,
    entityName: row.entity_name as string,
    parentEntity: row.parent_entity as string,
    content: row.content as string,
    summary: row.summary as string,
    metadata: (row.metadata as Record<string, unknown>) || {},
    sequenceOrder: row.sequence_order as number,
  };
}

/**
 * Maps a database row to a CampaignRule object
 */
export function mapRuleRow(row: Record<string, unknown>): CampaignRule {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    ruleType: row.rule_type as 'causality' | 'mechanic' | 'world_law',
    condition: row.condition as string,
    effect: row.effect as string,
    reversible: row.reversible as boolean,
    priority: row.priority as number,
  };
}
