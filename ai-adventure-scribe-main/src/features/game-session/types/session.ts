import type { GameSession } from '@/types/game';

/**
 * ⚡ Bolt: Explicit column list for game session retrieval to avoid over-fetching
 * large fields like 'summary' when not needed for session initialization or UI.
 */
export const GAME_SESSION_SELECT_COLUMNS =
  'id, campaign_id, character_id, session_number, status, start_time, end_time, summary, turn_count, current_scene_description, session_notes';

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
