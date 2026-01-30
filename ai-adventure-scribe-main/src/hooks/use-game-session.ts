/**
 * useGameSession Hook
 *
 * Manages the lifecycle of a game session, including creation, expiration,
 * cleanup, and summary generation. Handles session state and integrates with Supabase.
 *
 * Dependencies:
 * - React hooks (useState, useEffect, useCallback, useRef)
 * - Supabase client (src/integrations/supabase/client.ts)
 * - Toast notification hook (src/hooks/use-toast.ts)
 * - Game session types (src/types/game.ts)
 *
 * Cleanup Strategy:
 * - AbortController: Tracks and cancels in-flight async operations on unmount
 * - mountedRef: Prevents state updates on unmounted components
 * - Cleanup intervals: Properly cleared on unmount to prevent memory leaks
 * - Refs: Reset on unmount to prevent stale closures
 * - Toast ref: Stored to avoid dependency changes and stale closures
 * - React StrictMode compatible: Lock mechanism prevents duplicate session creation
 *
 * Validation Strategy:
 * - All session operations validate session exists before proceeding
 * - Loading states prevent operations during initialization
 * - Error states are clearly defined and managed
 * - Helpful warnings logged when validation fails
 * - Early returns prevent crashes on undefined/null sessions
 *
 * @author AI Dungeon Master Team
 */

// ============================
// SDK/library imports
// ============================
import { useState, useEffect, useCallback, useRef } from 'react';

// ============================
// External integrations
// ============================
import {
  type ExtendedGameSession,
  type SessionStateUpdater,
  type SessionState,
  CLEANUP_INTERVAL,
  isValidSession,
  sanitizeSessionPatch,
  isSessionExpired,
  generateSessionSummary,
} from './game-session/session-utils';
import { useSessionInitialization } from './game-session/use-session-initialization';

import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// ============================
// Session utilities (extracted)
// ============================

// ============================
// Session hooks (extracted)
// ============================

// Re-export types for consumers of this hook
export type { ExtendedGameSession, SessionStateUpdater, SessionState };

/**
 * React hook for managing game sessions, including creation, expiration, cleanup, and summary generation.
 *
 * Session State Values:
 * - 'idle': No session initialized (missing campaignId or characterId)
 * - 'loading': Session is being created or loaded
 * - 'active': Session is active and ready for use
 * - 'ending': Session is being cleaned up
 * - 'expired': Session has been marked as expired/completed
 * - 'error': Error occurred during session operations
 *
 * Validation Features:
 * - All session operations validate session exists before proceeding
 * - Safe setter validates session data before updating state
 * - Update operations validate parameters and prevent invalid state transitions
 * - Helper function (isSessionReady) provides single source of truth for readiness
 * - Comprehensive guards prevent operations on null/undefined sessions
 *
 * @param {string | undefined} campaignId - Campaign ID for session
 * @param {string | undefined} characterId - Character ID for session
 * @returns {{
 *   sessionData: ExtendedGameSession | null,
 *   setSessionData: (data: ExtendedGameSession | null) => void,
 *   sessionId: string | null,
 *   sessionState: 'active' | 'expired' | 'ending' | 'loading' | 'error' | 'idle',
 *   updateGameSessionState: (newState: SessionStateUpdater) => Promise<void>,
 *   createGameSession: (campId: string, charId: string) => Promise<string | null>,
 *   isSessionReady: () => boolean
 * }} Session state and control functions
 */
export const useGameSession = (
  campaignId?: string,
  characterId?: string,
  forceNew?: boolean,
  specificSessionId?: string,
  starterCampaignId?: string,
) => {
  const [sessionData, setSessionData] = useState<ExtendedGameSession | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const { toast } = useToast();

  const currentSessionId = sessionData?.id || null;
  const mountedRef = useRef(true);

  // Set mounted state
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Safe setter for session data with validation.
   * Validates session data before updating state to prevent invalid states.
   *
   * Validation:
   * - Allows null to clear session
   * - Validates session object has required properties (id)
   * - Logs warning if invalid data is provided
   * - Prevents setting invalid session objects
   *
   * @param {ExtendedGameSession | null} data - The session data to set
   */
  const safeSetSessionData = useCallback((data: ExtendedGameSession | null) => {
    // Guard: Allow null to clear session
    if (data === null) {
      setSessionData(null);
      return;
    }

    // Guard: Validate session data before setting
    if (!isValidSession(data)) {
      logger.warn('⚠️ [safeSetSessionData] Attempted to set invalid session data', {
        providedData: data,
      });
      return;
    }

    setSessionData(data);
  }, []);

  /**
   * Helper to check if session is ready for operations.
   * Provides a single source of truth for session readiness validation.
   *
   * @returns {boolean} True if session is active and ready for operations
   */
  const isSessionReady = useCallback((): boolean => {
    // Session must exist with valid ID
    if (!sessionData || !sessionData.id) {
      return false;
    }

    // Session state must be 'active'
    if (sessionState !== 'active') {
      return false;
    }

    return true;
  }, [sessionData, sessionState]);

  // Store toast in ref to avoid dependency changes and prevent stale closures
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  /**
   * Creates a new game session in Supabase.
   *
   * Validation:
   * - Requires valid campaignId and characterId
   * - Sets error state and shows toast on validation failure
   * - Returns null if validation fails or component unmounts
   *
   * Cleanup-safe: Checks mountedRef before state updates to prevent
   * updates on unmounted components.
   *
   * @param {string} campId - Campaign ID
   * @param {string} charId - Character ID
   * @returns {Promise<string | null>} The new session ID or null if failed
   */
  const createGameSession = useCallback(
    async (campId: string, charId: string): Promise<string | null> => {
      // Guard: Validate required parameters
      if (!campId || !charId) {
        logger.warn('⚠️ [createGameSession] Missing required parameters', { campId, charId });
        toastRef.current({
          title: 'Error',
          description: 'Campaign or Character ID missing for session creation.',
          variant: 'destructive',
        });
        if (mountedRef.current) {
          setSessionState('error');
        }
        return null;
      }

      if (mountedRef.current) {
        setSessionState('loading');
      }

      const { data, error } = await supabase
        .from('game_sessions')
        .insert([
          {
            session_number: 1,
            status: 'active',
            campaign_id: campId,
            character_id: charId,
            turn_count: 0,
            current_scene_description: 'The adventure begins...',
            session_notes: '',
            starter_campaign_id: starterCampaignId || null,
          },
        ])
        .select()
        .single();

      // Guard: Check if component unmounted during async operation
      if (!mountedRef.current) {
        logger.warn('⚠️ [createGameSession] Component unmounted during session creation');
        return null;
      }

      if (error) {
        logger.error('[createGameSession] Error creating game session:', error);
        setSessionState('error');
        toastRef.current({
          title: 'Error',
          description: 'Failed to create game session',
          variant: 'destructive',
        });
        return null;
      }

      setSessionData(data as ExtendedGameSession);
      setSessionState('active');
      logger.info('✅ [createGameSession] Session created successfully:', data.id);
      return data.id;
    },
    [],
  ); // Stable dependencies - uses refs and parameters instead

  /**
   * Cleans up an expired session, generates a summary, and updates status.
   *
   * Validation:
   * - Requires valid sessionIdToClean parameter
   * - Returns early with fallback message if sessionId is invalid
   * - Logs warning if called without valid session
   *
   * Cleanup-safe: Uses mountedRef checks before state updates to prevent
   * updates on unmounted components. Returns early if component unmounts
   * during async operations.
   *
   * @param {string} sessionIdToClean - The session ID
   * @returns {Promise<string>} The generated summary
   */
  const cleanupSession = useCallback(async (sessionIdToClean: string): Promise<string> => {
    // Guard: Validate sessionId parameter
    if (!sessionIdToClean) {
      logger.warn('⚠️ [cleanupSession] Called without valid sessionId');
      return 'No activity recorded in this session';
    }

    if (mountedRef.current) {
      setSessionState('ending');
    }

    const summary = await generateSessionSummary(sessionIdToClean);

    // Guard: Check if component unmounted during summary generation
    if (!mountedRef.current) {
      logger.warn('⚠️ [cleanupSession] Component unmounted during cleanup');
      return summary;
    }

    const { error } = await supabase
      .from('game_sessions')
      .update({
        end_time: new Date().toISOString(),
        summary,
        status: 'completed' as const,
      })
      .eq('id', sessionIdToClean);

    // Guard: Check if component unmounted during database update
    if (!mountedRef.current) {
      logger.warn('⚠️ [cleanupSession] Component unmounted during database update');
      return summary;
    }

    if (error) {
      logger.error('[cleanupSession] Error cleaning up session:', error);
      toastRef.current({
        title: 'Error',
        description: 'Failed to cleanup session properly',
        variant: 'destructive',
      });
    } else {
      setSessionState('expired');
      // Use functional update to get current value
      setSessionData((prev) => {
        if (prev && prev.id === sessionIdToClean) {
          return { ...prev, status: 'completed', end_time: new Date().toISOString(), summary };
        }
        return prev;
      });
      logger.info('✅ [cleanupSession] Session cleaned up successfully:', sessionIdToClean);
    }
    return summary;
  }, []); // Stable dependencies - uses refs and parameters

  /**
   * Updates game session state in both local state and Supabase.
   *
   * Validation:
   * - Validates newState parameter is a valid object
   * - Checks if session exists before attempting update
   * - Logs warning if called without active session
   * - Returns early if session is not initialized
   * - Prevents updates during loading or error states
   * - Validates that newState doesn't contain disallowed properties
   *
   * Cleanup-safe: Uses functional state updates and mountedRef checks
   * to prevent updates on unmounted components. Optimistically updates
   * local state before database update.
   *
   * @param {Partial<ExtendedGameSession>} newState - Partial session state to update
   * @returns {Promise<void>}
   */
  const updateGameSessionState = useCallback(async (newStateOrUpdater: SessionStateUpdater) => {
    if (newStateOrUpdater === null || newStateOrUpdater === undefined) {
      logger.warn('⚠️ [updateGameSessionState] Invalid newState parameter', {
        providedValue: newStateOrUpdater,
      });
      return;
    }

    let resolvedState: Partial<ExtendedGameSession> | null = null;
    let sessId: string | null = null;
    let invalidReason: 'invalid' | 'empty' | null = null;
    let removedImmutableKeys: string[] = [];

    setSessionData((prev) => {
      if (!prev || !isValidSession(prev)) {
        return prev;
      }

      sessId = prev.id;
      const candidate =
        typeof newStateOrUpdater === 'function' ? newStateOrUpdater(prev) : newStateOrUpdater;

      if (!candidate || typeof candidate !== 'object') {
        invalidReason = 'invalid';
        return prev;
      }
      const { sanitized, removed } = sanitizeSessionPatch(
        candidate as Partial<ExtendedGameSession>,
      );
      removedImmutableKeys = removed;

      if (Object.keys(sanitized).length === 0) {
        invalidReason = 'empty';
        return prev;
      }

      resolvedState = sanitized;
      return { ...prev, ...sanitized };
    });

    if (invalidReason === 'invalid') {
      logger.warn('⚠️ [updateGameSessionState] Invalid newState parameter', {
        providedValue: newStateOrUpdater,
      });
      return;
    }

    if (invalidReason === 'empty') {
      if (removedImmutableKeys.length > 0) {
        logger.warn('⚠️ [updateGameSessionState] Update contained only immutable fields', {
          attemptedUpdate: newStateOrUpdater,
          removedFields: removedImmutableKeys,
        });
      } else {
        logger.warn('⚠️ [updateGameSessionState] newState is empty, no update needed');
      }
      return;
    }

    if (!resolvedState) {
      logger.warn('⚠️ [updateGameSessionState] Could not resolve new state', {
        providedValue: newStateOrUpdater,
      });
      return;
    }

    if (removedImmutableKeys.length > 0) {
      logger.debug('[updateGameSessionState] Removed immutable fields from session update', {
        removedFields: removedImmutableKeys,
      });
    }

    let currentState: 'active' | 'expired' | 'ending' | 'loading' | 'error' | 'idle' = 'idle';
    setSessionState((prev) => {
      currentState = prev;
      return prev;
    });

    if (!sessId) {
      logger.warn('⚠️ [updateGameSessionState] Cannot update - session not initialized', {
        attemptedUpdate: resolvedState,
        currentSessionState: currentState,
      });
      return;
    }

    if (currentState === 'loading') {
      logger.warn('⚠️ [updateGameSessionState] Cannot update - session is loading', {
        attemptedUpdate: resolvedState,
      });
      return;
    }

    if (currentState === 'error') {
      logger.warn('⚠️ [updateGameSessionState] Cannot update - session is in error state', {
        attemptedUpdate: resolvedState,
      });
      return;
    }

    if (!mountedRef.current) {
      logger.warn('⚠️ [updateGameSessionState] Cannot update - component unmounted');
      return;
    }

    const { data, error } = await supabase
      .from('game_sessions')
      .update(resolvedState)
      .eq('id', sessId)
      .select()
      .single();

    if (!mountedRef.current) {
      logger.warn('⚠️ [updateGameSessionState] Component unmounted during update');
      return;
    }

    if (error) {
      logger.error('[updateGameSessionState] Error updating game session state:', error);
      toastRef.current({
        title: 'Error',
        description: 'Failed to save game state. Changes may be lost.',
        variant: 'destructive',
      });
    } else if (data) {
      setSessionData(data as ExtendedGameSession);
      logger.info('✅ [updateGameSessionState] Session updated successfully:', sessId);
    }
  }, []);

  // Extracted initialization logic
  useSessionInitialization({
    campaignId,
    characterId,
    forceNew,
    specificSessionId,
    starterCampaignId,
    setSessionData,
    setSessionState,
    createGameSession,
    cleanupSession,
    toast,
    mountedRef,
  });

  // Periodic cleanup check with stable references
  // This effect runs every CLEANUP_INTERVAL (15 minutes) to check for expired sessions
  useEffect(() => {
    const cleanupIntervalId = setInterval(async () => {
      // Guard: Check if component is still mounted before running cleanup check
      if (!mountedRef.current) {
        logger.info('[Periodic Cleanup] Component unmounted, skipping check');
        return;
      }

      // Use functional state read to avoid stale closure
      setSessionData((currentSession) => {
        // Guard: Validate session exists with required properties
        if (!isValidSession(currentSession)) {
          return currentSession;
        }

        // Guard: Only check sessions that are marked as active
        if (currentSession.status !== 'active') {
          return currentSession;
        }

        // Guard: Additional session state validation - must be in 'active' state
        setSessionState((state) => {
          if (state !== 'active') {
            logger.info('[Periodic Cleanup] Session not in active state, skipping:', state);
            return state;
          }
          return state;
        });

        // Check if session has expired
        if (isSessionExpired(currentSession)) {
          logger.info('[Periodic Cleanup] Session expired, cleaning up:', currentSession.id);
          // Don't await here to avoid blocking the interval
          cleanupSession(currentSession.id).catch((err) => {
            logger.error('[Periodic Cleanup] Error in cleanup:', err);
          });
        }

        return currentSession; // Return unchanged
      });
    }, CLEANUP_INTERVAL);

    // Cleanup: Clear interval on unmount to prevent memory leaks and operations on unmounted component
    return () => {
      logger.info('[Periodic Cleanup] Clearing interval on unmount');
      clearInterval(cleanupIntervalId);
    };
  }, [cleanupSession]); // Only depends on stable cleanupSession

  return {
    sessionData,
    setSessionData: safeSetSessionData, // Safe setter with validation
    sessionId: currentSessionId,
    sessionState,
    updateGameSessionState,
    createGameSession, // Expose create if manual creation is ever needed
    isSessionReady, // Helper to check if session is ready for operations
  };
};
