/**
 * Game Session Utilities
 * Extracted helper functions for session management
 */

import type { GameSession } from '@/types/game';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

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
 * Session state updater type for functional updates
 */
export type SessionStateUpdater =
  | Partial<ExtendedGameSession>
  | ((prev: ExtendedGameSession) => Partial<ExtendedGameSession> | null | undefined);

/**
 * Session state values
 */
export type SessionState = 'active' | 'expired' | 'ending' | 'loading' | 'error' | 'idle';

/**
 * Session expiry configuration
 */
export const SESSION_EXPIRY_TIME = 1000 * 60 * 60 * 24 * 7; // 7 days for free tier
export const CLEANUP_INTERVAL = 1000 * 60 * 15; // Check every 15 minutes

/**
 * Fields that cannot be updated via session patches
 */
export const IMMUTABLE_SESSION_FIELDS = new Set<keyof ExtendedGameSession | string>([
  'id',
  'campaign_id',
  'character_id',
  'created_at',
  'updated_at',
  'sequence_number',
]);

/**
 * Validates that a session object has required properties.
 */
export function isValidSession(session: any): session is ExtendedGameSession {
  return !!(session && typeof session === 'object' && typeof session.id === 'string');
}

/**
 * Sanitize a session patch by removing immutable fields.
 * @returns Object with sanitized patch and list of removed field names
 */
export function sanitizeSessionPatch(patch: Partial<ExtendedGameSession>): {
  sanitized: Partial<ExtendedGameSession>;
  removed: string[];
} {
  const sanitized: Partial<ExtendedGameSession> = {};
  const removed: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (IMMUTABLE_SESSION_FIELDS.has(key)) {
      removed.push(key);
      continue;
    }

    sanitized[key as keyof ExtendedGameSession] =
      value as ExtendedGameSession[keyof ExtendedGameSession];
  }

  return { sanitized, removed };
}

/**
 * Checks if a session has expired based on start time.
 */
export function isSessionExpired(session: ExtendedGameSession): boolean {
  if (!session || !session.id) {
    logger.warn('⚠️ [isSessionExpired] Called without valid session');
    return false;
  }

  const startTime = session.start_time ? new Date(session.start_time).getTime() : Date.now();
  const currentTime = Date.now();
  const elapsed = currentTime - startTime;
  const isExpired = elapsed > SESSION_EXPIRY_TIME;

  if (isExpired) {
    logger.info(`⏰ Session ${session.id} expired:`, {
      sessionId: session.id,
      startTime: new Date(startTime).toISOString(),
      currentTime: new Date(currentTime).toISOString(),
      elapsedHours: Math.round((elapsed / (1000 * 60 * 60)) * 100) / 100,
      expiryHours: SESSION_EXPIRY_TIME / (1000 * 60 * 60),
    });
  } else {
    logger.info(`✅ Session ${session.id} still active:`, {
      sessionId: session.id,
      elapsedHours: Math.round((elapsed / (1000 * 60 * 60)) * 100) / 100,
      remainingHours:
        Math.round(((SESSION_EXPIRY_TIME - elapsed) / (1000 * 60 * 60)) * 100) / 100,
    });
  }

  return isExpired;
}

/**
 * Generates a summary string for the session based on dialogue history.
 */
export async function generateSessionSummary(sessionId: string): Promise<string> {
  if (!sessionId) {
    logger.warn('⚠️ [generateSessionSummary] Called without valid sessionId');
    return 'No activity recorded in this session';
  }

  try {
    const { data: messages, error } = await supabase
      .from('dialogue_history')
      .select('message, speaker_type, context')
      .eq('session_id', sessionId)
      .order('sequence_number', { ascending: true });

    if (error) {
      logger.error('[generateSessionSummary] Error fetching dialogue history:', error);
      return 'No activity recorded in this session';
    }

    if (!messages?.length) {
      logger.info('[generateSessionSummary] No messages found for session:', sessionId);
      return 'No activity recorded in this session';
    }

    // Simple summary generation - can be enhanced with AI later
    const messageCount = messages.length;
    const playerActions = messages.filter((m) => m.speaker_type === 'player').length;
    const dmResponses = messages.filter((m) => m.speaker_type === 'dm').length;

    return `Session completed with ${messageCount} total interactions: ${playerActions} player actions and ${dmResponses} DM responses.`;
  } catch (err) {
    logger.error('[generateSessionSummary] Error generating session summary:', err);
    return 'No activity recorded in this session';
  }
}

/**
 * Creates a new game session in Supabase.
 */
export async function createSessionInDatabase(
  campaignId: string,
  characterId: string
): Promise<ExtendedGameSession | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .insert([
      {
        session_number: 1,
        status: 'active',
        campaign_id: campaignId,
        character_id: characterId,
        turn_count: 0,
        current_scene_description: 'The adventure begins...',
        session_notes: '',
      },
    ])
    .select()
    .single();

  if (error) {
    logger.error('[createSessionInDatabase] Error creating game session:', error);
    return null;
  }

  logger.info('✅ [createSessionInDatabase] Session created successfully:', data.id);
  return data as ExtendedGameSession;
}

/**
 * Cleans up an expired session in the database.
 */
export async function cleanupSessionInDatabase(
  sessionId: string,
  summary: string
): Promise<boolean> {
  const { error } = await supabase
    .from('game_sessions')
    .update({
      end_time: new Date().toISOString(),
      summary,
      status: 'completed' as const,
    })
    .eq('id', sessionId);

  if (error) {
    logger.error('[cleanupSessionInDatabase] Error cleaning up session:', error);
    return false;
  }

  logger.info('✅ [cleanupSessionInDatabase] Session cleaned up successfully:', sessionId);
  return true;
}

/**
 * Fetches existing sessions for a campaign/character combination.
 */
export async function fetchExistingSessions(
  campaignId: string,
  characterId: string,
  limit: number = 5
): Promise<ExtendedGameSession[]> {
  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('character_id', characterId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('[fetchExistingSessions] Error fetching sessions:', error);
    return [];
  }

  return (data || []) as ExtendedGameSession[];
}

/**
 * Fetches a specific session by ID.
 */
export async function fetchSessionById(sessionId: string): Promise<ExtendedGameSession | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (error) {
    logger.error('[fetchSessionById] Error fetching session:', error);
    return null;
  }

  return data as ExtendedGameSession;
}

/**
 * Updates a session in the database.
 */
export async function updateSessionInDatabase(
  sessionId: string,
  updates: Partial<ExtendedGameSession>
): Promise<ExtendedGameSession | null> {
  const { data, error } = await supabase
    .from('game_sessions')
    .update(updates)
    .eq('id', sessionId)
    .select()
    .single();

  if (error) {
    logger.error('[updateSessionInDatabase] Error updating session:', error);
    return null;
  }

  return data as ExtendedGameSession;
}
