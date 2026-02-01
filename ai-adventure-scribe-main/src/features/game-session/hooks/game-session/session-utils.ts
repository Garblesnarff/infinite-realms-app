/**
 * Game Session Utilities
 * Extracted helper functions and constants for session management
 */

import { type ExtendedGameSession } from '../../types/session';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Session expiry configuration
 */
export const SESSION_EXPIRY_TIME = 1000 * 60 * 60 * 24; // 24 hours
export const CLEANUP_INTERVAL = 1000 * 60 * 15; // Check every 15 minutes

/**
 * Validates that a session object has required properties.
 *
 * @param {unknown} session - The session object to validate
 * @returns {boolean} True if session has required properties
 */
export const isValidSession = (session: unknown): session is ExtendedGameSession => {
  return (
    !!session &&
    typeof session === 'object' &&
    'id' in session &&
    typeof (session as Record<string, unknown>).id === 'string'
  );
};

/**
 * Checks if a session has expired based on start time.
 *
 * @param {ExtendedGameSession} session - The session object
 * @returns {boolean} True if expired, false otherwise
 */
export const isSessionExpired = (session: ExtendedGameSession): boolean => {
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
  }

  return isExpired;
};

/**
 * Generates a summary string for the session based on dialogue history.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<string>} The generated summary
 */
export const generateSessionSummary = async (sessionId: string): Promise<string> => {
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

    const messageCount = messages.length;
    const playerActions = messages.filter((m) => m.speaker_type === 'player').length;
    const dmResponses = messages.filter((m) => m.speaker_type === 'dm').length;

    return `Session completed with ${messageCount} total interactions: ${playerActions} player actions and ${dmResponses} DM responses.`;
  } catch (err) {
    logger.error('[generateSessionSummary] Error generating session summary:', err);
    return 'No activity recorded in this session';
  }
};
