import type {
  DMCombatAction,
  DMHandoutAction,
  DMMapAction,
} from '../../../../server-bun/src/services/dm/dm-response-schema';

/**
 * Shared TypeScript types and interfaces for AI service modules
 * Extracted from ai-service.ts for reusability across modules
 */

/**
 * Chat message structure for conversation history
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  narrationSegments?: NarrationSegment[];
  speakerType?: 'player' | 'dm' | 'system' | 'companion';
  speakerName?: string;
}

/**
 * Narration segment for multi-voice text-to-speech
 */
export type NarrationSegment = {
  type: 'dm' | 'character' | 'transition';
  text: string;
  character?: string;
  voice_category?: string;
};

/**
 * Game context for AI interactions
 */
export interface GameContext {
  campaignId: string;
  characterId: string;
  sessionId?: string;
  userId?: string;
  starterCampaignId?: string;
  isStarterPlaythrough?: boolean;
  campaignDetails?: Record<string, unknown>;
  characterDetails?: Record<string, unknown>;
  gameState?: Record<string, unknown>;
  /**
   * "Previously On" recap text for continuation sessions (session_number > 1).
   * When present, the opening prompt renders it as a <previous_session_recap>
   * block so the DM opens with continuity instead of starting blind.
   */
  previousSessionRecap?: string;
}

/**
 * Campaign generation parameters
 */
export interface CampaignParams {
  genre: string;
  difficulty: string;
  length: string;
  tone: string;
}

/**
 * AI response structure with optional features
 */
export interface AIResponse {
  text: string;
  options?: unknown[];
  narrationSegments?: NarrationSegment[];
  roll_requests?: unknown[];
  dice_rolls?: unknown[];
  combat_transition?: 'none' | 'start' | 'end';
  scene_spec?: unknown | null;
  /**
   * #1907 PR1/PR2: an explicit combat-entry response seated an encounter.
   * The client reacts to this server result; it never decides entry from model text.
   */
  combat_entry?: {
    entered: true;
    encounterId: string;
    trigger: 'combat_transition' | 'tactical_action' | 'attack_roll_request';
    detail: string;
    sceneSpecSynthesized: boolean;
  };
  /** #1907 PR1: detected combat awaiting the player's explicit seating confirmation. */
  combat_entry_pending?: {
    trigger: 'combat_transition' | 'tactical_action' | 'attack_roll_request';
    detail: string;
    combatants: Array<{ name: string; monsterId?: string; count: number }>;
    sceneSpec: unknown;
    sceneSpecSynthesized: boolean;
  };
  map_actions?: DMMapAction[];
  handout_actions?: DMHandoutAction[];
  combat_actions?: DMCombatAction[];
  combatants?: unknown[];
  combatDetection?: {
    isCombat: boolean;
    confidence: number;
    combatType: string;
    shouldStartCombat: boolean;
    shouldEndCombat: boolean;
    enemies: unknown[];
    combatActions: unknown[];
  };
}
