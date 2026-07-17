import { useCallback } from 'react';

import {
  type ExtendedGameSession,
  type SessionStateUpdater,
  type SessionState,
  isValidSession,
  sanitizeSessionPatch,
  generateSessionSummary,
} from './session-utils';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface UseSessionManagementProps {
  setSessionData: React.Dispatch<React.SetStateAction<ExtendedGameSession | null>>;
  setSessionState: React.Dispatch<React.SetStateAction<SessionState>>;
  mountedRef: React.MutableRefObject<boolean>;
  toastRef: React.MutableRefObject<any>;
  starterCampaignId?: string;
}

/**
 * Hook for managing game session operations: creation, cleanup, and state updates.
 * Extracted from use-game-session.ts to improve modularity and maintainability.
 */
export const useSessionManagement = ({
  setSessionData,
  setSessionState,
  mountedRef,
  toastRef,
  starterCampaignId,
}: UseSessionManagementProps) => {
  /**
   * Creates a new game session in Supabase.
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

      try {
        const data = await userDataApi.createSession({
          session_number: 1,
          status: 'active',
          campaign_id: campId,
          character_id: charId,
          turn_count: 0,
          current_scene_description: 'The adventure begins...',
          session_notes: '',
          starter_campaign_id: starterCampaignId || null,
        });

        // Guard: Check if component unmounted during async operation
        if (!mountedRef.current) {
          logger.warn('⚠️ [createGameSession] Component unmounted during session creation');
          return null;
        }

        setSessionData(data as ExtendedGameSession);
        setSessionState('active');
        logger.info('✅ [createGameSession] Session created successfully:', data.id);
        return data.id;
      } catch (error) {
        logger.error('[createGameSession] Error creating game session:', error);
        setSessionState('error');
        toastRef.current({
          title: 'Error',
          description: 'Failed to create game session',
          variant: 'destructive',
        });
        return null;
      }
    },
    [setSessionData, setSessionState, mountedRef, toastRef, starterCampaignId],
  );

  /**
   * Cleans up an expired session, generates a summary, and updates status.
   */
  const cleanupSession = useCallback(
    async (sessionIdToClean: string): Promise<string> => {
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

      let saveError: unknown;
      try {
        await userDataApi.completeSession(sessionIdToClean, summary);
      } catch (error) {
        saveError = error;
      }

      // Guard: Check if component unmounted during database update
      if (!mountedRef.current) {
        logger.warn('⚠️ [cleanupSession] Component unmounted during database update');
        return summary;
      }

      if (saveError) {
        logger.error('[cleanupSession] Error cleaning up session:', saveError);
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
    },
    [setSessionData, setSessionState, mountedRef, toastRef],
  );

  /**
   * Updates game session state in both local state and Supabase.
   */
  const updateGameSessionState = useCallback(
    async (newStateOrUpdater: SessionStateUpdater) => {
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

      let currentState: SessionState = 'idle';
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

      let data: ExtendedGameSession | null = null;
      let saveError: unknown;
      try {
        data = (await userDataApi.updateSession(
          sessId,
          resolvedState as Record<string, unknown>,
        )) as ExtendedGameSession;
      } catch (error) {
        saveError = error;
      }

      if (!mountedRef.current) {
        logger.warn('⚠️ [updateGameSessionState] Component unmounted during update');
        return;
      }

      if (saveError) {
        logger.error('[updateGameSessionState] Error updating game session state:', saveError);
        toastRef.current({
          title: 'Error',
          description: 'Failed to save game state. Changes may be lost.',
          variant: 'destructive',
        });
      } else if (data) {
        setSessionData(data as ExtendedGameSession);
        logger.info('✅ [updateGameSessionState] Session updated successfully:', sessId);
      }
    },
    [setSessionData, setSessionState, mountedRef, toastRef],
  );

  return {
    createGameSession,
    cleanupSession,
    updateGameSessionState,
  };
};
