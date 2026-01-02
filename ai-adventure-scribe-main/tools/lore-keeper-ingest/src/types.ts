/**
 * Types for the Lore Keeper ingestion pipeline
 */

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

export type Difficulty =
  | 'easy'
  | 'low-medium'
  | 'medium'
  | 'medium-hard'
  | 'hard'
  | 'deadly';

export type RuleType = 'causality' | 'mechanic' | 'world_law';

export interface CampaignFiles {
  creativeBrief?: string;
  worldBuildingSpec?: string;
  overview?: string;
  campaignBible?: string;
}

export interface ParsedCampaign {
  id: string;
  slug: string;
  title: string;
  tagline?: string;
  genre: string[];
  subGenre?: string[];
  tone: string[];
  difficulty: Difficulty;
  levelRange?: string;
  estimatedSessions?: string;
  premise: string;
  creativeBrief?: string;
  overview?: string;
}

export interface CampaignChunk {
  campaignId: string;
  chunkType: ChunkType;
  entityName?: string;
  parentEntity?: string;
  content: string;
  summary?: string;
  metadata: Record<string, unknown>;
  sourceFile: string;
  sourceSection?: string;
  sequenceOrder?: number;
}

export interface CampaignRule {
  campaignId: string;
  ruleType: RuleType;
  condition: string;
  effect: string;
  reversible: boolean;
  priority: number;
  metadata: Record<string, unknown>;
}

export interface IngestOptions {
  dryRun: boolean;
  verbose: boolean;
  campaignId?: string;
  repoPath: string;
  skipEmbeddings: boolean;
}

export interface IngestResult {
  campaignId: string;
  title: string;
  chunksCreated: number;
  rulesCreated: number;
  embeddingsGenerated: number;
  errors: string[];
}
