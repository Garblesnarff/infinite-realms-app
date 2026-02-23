import type { GeneratedLocation } from './location-generator';
import type { GeneratedNPC } from './npc-generator';
import type { GeneratedQuest } from './quest-generator';
import type { Memory } from '@/types/memory';

export interface WorldBuildingContext {
  campaignId: string;
  sessionId: string;
  characterId: string;
  playerAction: string;
  userId?: string; // SECURITY: Required for ownership validation
  currentLocation?: string;
  recentMemories?: Memory[];
  genre?: string;
  playerLevel?: number;
}

export interface WorldExpansionResult {
  locations: GeneratedLocation[];
  npcs: GeneratedNPC[];
  quests: GeneratedQuest[];
  narrativeElements: {
    hooks: string[];
    consequences: string[];
    opportunities: string[];
  };
}

export interface WorldBuildingTrigger {
  type: 'player_action' | 'story_progression' | 'random_event' | 'memory_based';
  confidence: number; // How certain we are that world building is needed
  suggestions: {
    locations?: string[];
    npcs?: string[];
    quests?: string[];
  };
}
