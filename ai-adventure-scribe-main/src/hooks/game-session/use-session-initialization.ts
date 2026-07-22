import { useEffect, useRef } from 'react';

import { type ExtendedGameSession, type SessionState, isSessionExpired } from './session-utils';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface UseSessionInitializationProps {
  campaignId?: string;
  characterId?: string;
  forceNew?: boolean;
  specificSessionId?: string;
  starterCampaignId?: string;
  setSessionData: (data: ExtendedGameSession | null) => void;
  setSessionState: (state: SessionState) => void;
  createGameSession: (campId: string, charId: string) => Promise<string | null>;
  cleanupSession: (sessionIdToClean: string) => Promise<string>;
  toast: {
    (props: { title?: string; description?: string; variant?: 'default' | 'destructive' }): void;
  };
  mountedRef: React.MutableRefObject<boolean>;
  /**
   * Called once a brand-new session has been successfully created via the
   * forceNew path. Intended for the caller to strip the `?new=true` (or
   * equivalent) query param from the URL so a page refresh takes the resume
   * path instead of creating another new session (see BUG: refresh creates a
   * new session because `forceNew` stays true forever).
   */
  onForceNewSessionCreated?: () => void;
}

/**
 * Hook to manage game session initialization and resumption logic.
 * Handles race conditions, React StrictMode double-mounting, and session continuity.
 */
export const useSessionInitialization = ({
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
  onForceNewSessionCreated,
}: UseSessionInitializationProps): void => {
  // Race condition prevention: track initialization status
  const initializingRef = useRef(false);
  const sessionInitializedRef = useRef(false);
  const lastInitKeyRef = useRef<string | null>(null);

  // AbortController for cancelling in-flight async operations
  const abortControllerRef = useRef<AbortController | null>(null);

  // Store toast in ref to avoid dependency changes and prevent stale closures
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  // Store the URL-cleanup callback in a ref too, for the same reason (avoid
  // retriggering the init effect just because the caller passed a fresh
  // function identity on every render).
  const onForceNewSessionCreatedRef = useRef(onForceNewSessionCreated);
  useEffect(() => {
    onForceNewSessionCreatedRef.current = onForceNewSessionCreated;
  }, [onForceNewSessionCreated]);

  useEffect(() => {
    // Guard: Only initialize if we have the required IDs
    if (!campaignId || !characterId) {
      if (mountedRef.current) {
        setSessionState('idle');
        logger.info('[Session Init] Waiting for campaignId and characterId');
      }
      return;
    }

    const initKey = [
      campaignId,
      characterId,
      forceNew ? 'force-new' : 'reuse',
      specificSessionId || 'none',
      starterCampaignId || 'none',
    ].join(':');

    if (lastInitKeyRef.current !== initKey) {
      sessionInitializedRef.current = false;
      lastInitKeyRef.current = initKey;
    }

    // Guard: Prevent concurrent initialization
    if (initializingRef.current) {
      logger.info('🔒 [Session Init] Already in progress, skipping to prevent duplicate creation');
      return;
    }

    // Guard: Skip if session already initialized successfully
    if (sessionInitializedRef.current) {
      logger.info('✓ [Session Init] Already initialized, skipping');
      return;
    }

    // Acquire lock
    initializingRef.current = true;
    logger.info(
      '🔓 [Session Init] Acquired lock - campaignId:',
      campaignId,
      'characterId:',
      characterId,
    );

    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    const initSession = async (): Promise<void> => {
      try {
        if (abortSignal.aborted) {
          logger.info('[Session Init] Aborted before starting');
          return;
        }

        if (mountedRef.current) {
          setSessionState('loading');
        }

        const handleSessionCreationFailure = (context: string) => {
          logger.error(`[Session Init] ${context}: createGameSession returned null`);
          if (!abortSignal.aborted && mountedRef.current) {
            setSessionState('error');
            toastRef.current({
              title: 'Error',
              description: 'Failed to create game session',
              variant: 'destructive',
            });
          }
          sessionInitializedRef.current = false;
        };

        // If forceNew=true, skip checking for existing sessions and create a new one
        if (forceNew) {
          logger.info('[Session Init] forceNew=true, creating new session');
          const newSessionId = await createGameSession(campaignId, characterId);
          if (newSessionId && mountedRef.current) {
            sessionInitializedRef.current = true;
            // Strip the forceNew URL param (e.g. `?new=true`) now that the new
            // session exists. Without this, refreshing the page re-enters this
            // same branch on mount and silently creates yet another session,
            // abandoning the one just created (BUG: refresh creates new session).
            onForceNewSessionCreatedRef.current?.();
          } else {
            handleSessionCreationFailure('forceNew path');
          }
          return;
        }

        // If specificSessionId is provided, load THAT specific session
        // Note: We include campaign_id and character_id filtering for extra security (IDOR prevention)
        if (specificSessionId) {
          logger.info('[Session Init] Loading specific session:', specificSessionId);
          // ⚡ Bolt: Use explicit core columns to avoid over-fetching
          let specificSession: ExtendedGameSession | null = null;
          let specificError: unknown;
          try {
            const candidate = (await userDataApi.getSession(
              specificSessionId,
            )) as ExtendedGameSession;
            if (candidate.campaign_id === campaignId && candidate.character_id === characterId)
              specificSession = candidate;
            else specificError = new Error('Session does not match campaign and character');
          } catch (error) {
            specificError = error;
          }

          if (abortSignal.aborted || !mountedRef.current) {
            logger.info('[Session Init] Aborted after specific session fetch');
            return;
          }

          if (specificError) {
            logger.error('[Session Init] Error loading specific session:', specificError);
          } else if (specificSession && mountedRef.current) {
            const extended = specificSession as ExtendedGameSession;
            setSessionData(extended);
            sessionInitializedRef.current = true;
            setSessionState('active');
            logger.info('[Session Init] Loaded specific session:', specificSessionId);
            return;
          }
        }

        // Find recent sessions
        // ⚡ Bolt: Use explicit core columns to avoid over-fetching during session lookup
        let existingSessions: ExtendedGameSession[] = [];
        let existingSessionError: unknown;
        try {
          existingSessions = (await userDataApi.listSessions({
            campaignId,
            characterId,
            limit: 5,
          })) as ExtendedGameSession[];
        } catch (error) {
          existingSessionError = error;
        }

        if (abortSignal.aborted || !mountedRef.current) {
          logger.info('[Session Init] Aborted after fetching sessions');
          return;
        }

        if (existingSessionError) {
          logger.error('[Session Init] Error fetching existing sessions:', existingSessionError);
          const newSessionId = await createGameSession(campaignId, characterId);
          if (newSessionId && mountedRef.current) {
            sessionInitializedRef.current = true;
          } else {
            handleSessionCreationFailure('fallback after existing session fetch error');
          }
          return;
        }

        // Resume active session if available
        let sessionToResume = existingSessions?.find((s) => s.status === 'active') as
          | ExtendedGameSession
          | undefined;

        if (sessionToResume) {
          if (isSessionExpired(sessionToResume)) {
            logger.info(
              '[Session Init] Found active session but expired, cleaning up:',
              sessionToResume.id,
            );
            await cleanupSession(sessionToResume.id);
            if (abortSignal.aborted || !mountedRef.current) {
              logger.info('[Session Init] Aborted after session cleanup');
              return;
            }
            sessionToResume = undefined;
          } else {
            logger.info('[Session Init] Resuming active session:', sessionToResume.id);
            if (mountedRef.current && !abortSignal.aborted) {
              setSessionData(sessionToResume);
              setSessionState('active');
              sessionInitializedRef.current = true;
            }
            return;
          }
        }

        // Create continuation from last completed session
        const lastCompletedSession = existingSessions?.find((s) => s.status === 'completed');

        if (lastCompletedSession) {
          logger.info(
            '[Session Init] Creating continuation from previous:',
            lastCompletedSession.id,
          );
          const sessionNumber =
            Math.max(...(existingSessions?.map((s) => s.session_number || 1) || [1])) + 1;

          try {
            const data = await userDataApi.createSession({
              session_number: sessionNumber,
              status: 'active',
              campaign_id: campaignId,
              character_id: characterId,
              turn_count: 0,
              current_scene_description:
                lastCompletedSession.current_scene_description || 'Continuing your adventure...',
              session_notes: `Continuing from Session ${lastCompletedSession.session_number || 1}`,
              starter_campaign_id: starterCampaignId || null,
            });

            if (abortSignal.aborted || !mountedRef.current) {
              logger.info('[Session Init] Aborted after continuation session insert');
              return;
            }

            if (mountedRef.current) {
              setSessionData(data as ExtendedGameSession);
              setSessionState('active');
              sessionInitializedRef.current = true;
            }
            return;
          } catch (error) {
            logger.error('[Session Init] Error creating continuation session:', error);
            setSessionState('error');
            toastRef.current({
              title: 'Error',
              description: 'Failed to create game session',
              variant: 'destructive',
            });
            return;
          }
        }

        // No existing sessions found, create the first one
        logger.info('[Session Init] No existing sessions, creating first session');
        const newSessionId = await createGameSession(campaignId, characterId);
        if (newSessionId && mountedRef.current) {
          sessionInitializedRef.current = true;
        } else {
          handleSessionCreationFailure('initial session creation');
        }
      } catch (error) {
        logger.error('[Session Init] Error in session initialization:', error);
        if (mountedRef.current) {
          setSessionState('error');
          toastRef.current({
            title: 'Error',
            description: 'Failed to initialize game session',
            variant: 'destructive',
          });
        }
        initializingRef.current = false;
        sessionInitializedRef.current = false;
      } finally {
        initializingRef.current = false;
      }
    };

    initSession();

    return () => {
      logger.info('🔓 [Session Init] Releasing lock on unmount');
      initializingRef.current = false;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [
    campaignId,
    characterId,
    createGameSession,
    cleanupSession,
    forceNew,
    specificSessionId,
    starterCampaignId,
    setSessionData,
    setSessionState,
    mountedRef,
  ]);
};
