/**
 * Quest generation request/result types, split out of quest-generator.ts.
 */

import type { Memory } from '@/types/memory';

export interface QuestRequest {
  type:
    | 'main'
    | 'side'
    | 'personal'
    | 'fetch'
    | 'kill'
    | 'escort'
    | 'investigation'
    | 'social'
    | 'exploration';
  difficulty: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
  urgency: 'immediate' | 'soon' | 'whenever' | 'background';
  scope: 'single-session' | 'multi-session' | 'campaign-arc';
  giver?: string; // NPC name or ID
  location?: string; // Where the quest takes place
  context: {
    campaignId: string;
    sessionId?: string;
    characterId: string;
    genre: string;
    playerLevel?: number;
    currentStory?: string;
    recentMemories?: Memory[];
    partySize?: number;
  };
}

export interface QuestStage {
  id: number;
  title: string;
  description: string;
  objectives: string[];
  location: string;
  challenges: string[];
  npcsInvolved: string[];
  rewards?: {
    experience?: number;
    gold?: number;
    items?: string[];
  };
  consequences: string[];
  nextStages: number[];
  isOptional: boolean;
}

export interface GeneratedQuest {
  id?: string;

  // Core Quest Info
  title: string;
  description: string;
  type: string;
  difficulty: string;
  estimatedTime: string;

  // Quest Structure
  objective: {
    primary: string;
    secondary: string[];
    hidden: string[];
  };

  // Quest Progression
  stages: QuestStage[];

  // Rewards & Consequences
  rewards: {
    experience: number;
    gold: number;
    items: string[];
    reputation: string[];
    storyImpact: string[];
  };

  consequences: {
    success: string[];
    failure: string[];
    partialSuccess: string[];
  };

  // Story Integration
  lore: string;
  backstory: string;
  connections: {
    npcs: string[];
    locations: string[];
    otherQuests: string[];
    factions: string[];
  };

  // Gameplay Elements
  challenges: {
    combat: string[];
    social: string[];
    exploration: string[];
    puzzles: string[];
  };

  // Narrative Hooks
  hooks: {
    initial: string[];
    ongoing: string[];
    twists: string[];
  };

  // Metadata
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    characterId: string;
    giver?: string;
    urgency: string;
    scope: string;
    narrativeWeight: number;
    storyArc?: string;
  };
}
