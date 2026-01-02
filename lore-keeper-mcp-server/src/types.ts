/**
 * Types for Lore Keeper MCP Server
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

export type RuleType = 'causality' | 'mechanic' | 'world_law';

export type Playstyle =
  | 'roleplay-heavy'
  | 'combat-focused'
  | 'balanced'
  | 'exploration'
  | 'puzzle-solving';

export interface StarterCampaign {
  id: string;
  slug: string;
  title: string;
  tagline?: string;
  genre: string[];
  subGenre?: string[];
  tone: string[];
  difficulty: string;
  levelRange?: string;
  estimatedSessions?: string;
  premise: string;
  creativeBrief?: string;
  overview?: string;
  isComplete: boolean;
  isPublished: boolean;
  isFeatured: boolean;
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
  sourceFile?: string;
  sourceSection?: string;
  sequenceOrder?: number;
  similarity?: number;
}

export interface CampaignRule {
  id: string;
  campaignId: string;
  ruleType: RuleType;
  condition: string;
  effect: string;
  reversible: boolean;
  priority: number;
  metadata: Record<string, unknown>;
}

export interface CampaignParty {
  id: string;
  campaignId: string;
  partyName: string;
  partyConcept: string;
  partyHook: string;
  playstyle: Playstyle;
  isDefault: boolean;
}

export interface PartyCharacter {
  id: string;
  partyId: string;
  characterName: string;
  race: string;
  characterClass: string;
  level: number;
  backstory: string;
  personality: string;
  campaignHook: string;
  partyRelationship?: string;
  stats: UniversalCharacterStats;
  portraitUrl?: string;
}

export interface UniversalCharacterStats {
  attributes: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  archetype: string;
  combatStyle: string;
  specialAbilities: string[];
  proficiencies: string[];
}

export interface SearchResult extends CampaignChunk {
  similarity: number;
}
