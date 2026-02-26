import { useEffect, useRef } from 'react';

import { isSessionExpired } from './session-utils';
import { type ExtendedGameSession, type SessionState } from '../../types/session';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

type ToastFn = (options: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive';
}) => void;

interface UseSessionInitializationProps {
  campaignId?: string;
  characterId?: string;
  setSessionData: (data: ExtendedGameSession | null) => void;
  setSessionState: (state: SessionState) => void;
  createGameSession: (campId: string, charId: string) => Promise<string | null>;
  cleanupSession: (sessionIdToClean: string) => Promise<string>;
  toastRef: React.MutableRefObject<ToastFn>;
  mountedRef: React.MutableRefObject<boolean>;
}

/**
 * Hook to manage game session initialization and resumption logic.
 * Extracted from useGameSession to improve maintainability.
 */
export const useSessionInitialization = ({
  campaignId,
  characterId,
  setSessionData,
  setSessionState,
  createGameSession,
  cleanupSession,
  toastRef,
  mountedRef,
}: UseSessionInitializationProps): void => {
  const initializingRef = useRef(false);
  const sessionInitializedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!campaignId || !characterId) {
      if (mountedRef.current) setSessionState('idle');
      return;
    }

    if (initializingRef.current || sessionInitializedRef.current) return;

    initializingRef.current = true;
    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    const initSession = async (): Promise<void> => {
      try {
        if (abortSignal.aborted) return;
        if (mountedRef.current) setSessionState('loading');

        const { data: existingSessions, error: existingSessionError } = await supabase
          .from('game_sessions')
          .select('*')
          .eq('campaign_id', campaignId)
          .eq('character_id', characterId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (abortSignal.aborted || !mountedRef.current) return;

        if (existingSessionError) {
          logger.error('[Session Init] Error fetching existing sessions:', existingSessionError);
          const newSessionId = await createGameSession(campaignId, characterId);
          if (newSessionId && mountedRef.current) sessionInitializedRef.current = true;
          return;
        }

        let sessionToResume = existingSessions?.find((s) => s.status === 'active') as
          | ExtendedGameSession
          | undefined;
        if (sessionToResume) {
          if (isSessionExpired(sessionToResume)) {
            await cleanupSession(sessionToResume.id);
            if (abortSignal.aborted || !mountedRef.current) return;
            sessionToResume = undefined;
          } else {
            if (mountedRef.current && !abortSignal.aborted) {
              setSessionData(sessionToResume);
              setSessionState('active');
              sessionInitializedRef.current = true;
            }
            return;
          }
        }

        const lastCompletedSession = existingSessions?.find((s) => s.status === 'completed');
        if (lastCompletedSession) {
          const sessionNumber =
            Math.max(...(existingSessions?.map((s) => s.session_number || 1) || [1])) + 1;
          const { data, error } = await supabase
            .from('game_sessions')
            .insert([
              {
                session_number: sessionNumber,
                status: 'active',
                campaign_id: campaignId,
                character_id: characterId,
                turn_count: 0,
                current_scene_description:
                  lastCompletedSession.current_scene_description || 'Continuing your adventure...',
                session_notes: `Continuing from Session ${lastCompletedSession.session_number || 1}`,
              },
            ])
            .select()
            .single();

          if (!mountedRef.current) return;
          if (error) {
            setSessionState('error');
            toastRef.current({
              title: 'Error',
              description: 'Failed to create continuation session',
              variant: 'destructive',
            });
            return;
          }
          setSessionData(data as ExtendedGameSession);
          setSessionState('active');
          sessionInitializedRef.current = true;
          return;
        }

        const newId = await createGameSession(campaignId, characterId);
        if (newId && mountedRef.current) sessionInitializedRef.current = true;
      } catch (error) {
        logger.error('[Session Init] Error:', error);
        if (mountedRef.current) {
          setSessionState('error');
          toastRef.current({
            title: 'Error',
            description: 'Failed to initialize session',
            variant: 'destructive',
          });
        }
        initializingRef.current = false;
        sessionInitializedRef.current = false;
      }
    };

    initSession();

    return () => {
      initializingRef.current = false;
      sessionInitializedRef.current = false;
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
    mountedRef,
    setSessionData,
    setSessionState,
    toastRef,
  ]);
};
