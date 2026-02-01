import type { GameSession } from '@/types/game';

/**
 * Extended game session interface with additional properties
 */
export interface ExtendedGameSession extends GameSession {
  current_scene_description?: string | null;
  session_notes?: string | null;
  turn_count?: number | null;
  campaign_id?: string | null;
  character_id?: string | null;
}

/**
 * Session state values
 */
export type SessionState = 'active' | 'expired' | 'ending' | 'loading' | 'error' | 'idle';

/**
 * Session state updater type for functional updates
 */
export type SessionStateUpdater =
  | Partial<ExtendedGameSession>
  | ((prev: ExtendedGameSession) => Partial<ExtendedGameSession> | null | undefined);
