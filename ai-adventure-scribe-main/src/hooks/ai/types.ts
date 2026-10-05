/**
 * Shared types for AI response hook modules
 *
 * Centralizes type definitions used across roll-processor, session-logger,
 * and game-phase-updater to avoid circular dependencies.
 */

import type { NarrationSegment } from '@/services/ai/shared/types';
import type { EngineResultCard } from '@/services/combat/engine-result-card';
import type { AutoRollResult } from '@/services/combat/npc-auto-roller';
import type { RollRequest } from '@/types/roll-request';
import type { CombatDetectionResult } from '@/utils/combatDetection';

/**
 * Return type from AIService.chatWithDM
 * Replaces `as any` casts throughout the hook.
 */
export interface ChatWithDMResult {
  text: string;
  narrationSegments?: NarrationSegment[];
  narration_segments?: NarrationSegment[];
  roll_requests?: RollRequest[];
  dice_rolls?: unknown[];
  combatDetection?: CombatDetectionResult;
  image_requests?: ImageRequest[];
  imageRequests?: ImageRequest[];
}

export interface ImageRequest {
  prompt: string;
  style?: string;
  quality?: 'low' | 'medium' | 'high';
}

/**
 * Engine-authored system notices that are displayed by the client.
 *
 * Some notices describe a server mutation that has already been persisted (for
 * example, the combat seating transcript), so they must not be written again
 * by the client message queue.
 */
export interface LocalNotice {
  text: string;
  persist: boolean;
  /** Encounter whose engine event produced this notice. */
  combatEncounterId?: string;
  /** Cards that stand for `text` on screen (the seating card); `text` stays the screen reader line. */
  cards?: EngineResultCard[];
}

/**
 * Result of processing roll requests through deduplication,
 * suppression, and NPC auto-execution.
 */
export interface ProcessedRolls {
  /** Player-facing roll requests (for UI prompts) */
  playerRollRequests: RollRequest[];
  /** Auto-executed NPC roll results */
  npcRollResults: AutoRollResult[];
  /** AI narrative continuation text from NPC rolls */
  npcRollContinuationText: string;
}

/**
 * Parameters for dice roll result logging
 */
export interface DiceRollContext {
  formula?: string;
  total?: number;
  naturalRoll?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  keptResults?: number[];
  results?: number[];
  requestType?: string;
  description?: string;
  dc?: number;
  ac?: number;
  success?: boolean;
}

/**
 * Parameters for game phase transition evaluation
 */
export interface GamePhaseParams {
  combatDetection: CombatDetectionResult | undefined;
  currentPhase: string;
  isInCombat: boolean;
  setGamePhase: (phase: string) => void;
}
