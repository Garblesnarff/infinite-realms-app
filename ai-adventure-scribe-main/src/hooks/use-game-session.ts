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
  isSessionExpired,
} from './game-session/session-utils';
import { useSessionInitialization } from './game-session/use-session-initialization';
import { useSessionManagement } from './game-session/use-session-management';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';

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

  // Store toast in ref to avoid dependency changes and prevent stale closures
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  /**
   * Safe setter for session data with validation.
   * Validates session data before updating state to prevent invalid states.
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

  // Extract session management operations
  const { createGameSession, cleanupSession, updateGameSessionState } = useSessionManagement({
    setSessionData,
    setSessionState,
    mountedRef,
    toastRef,
    starterCampaignId,
  });

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
