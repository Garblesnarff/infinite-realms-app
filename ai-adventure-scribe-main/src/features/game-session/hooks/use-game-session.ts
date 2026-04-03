/**
 * useGameSession Hook
 *
 * Manages the lifecycle of a game session.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import {
  CLEANUP_INTERVAL,
  isValidSession,
  isSessionExpired,
  generateSessionSummary,
} from './game-session/session-utils';
import { useSessionInitialization } from './game-session/use-session-initialization';
import {
  type ExtendedGameSession,
  type SessionState,
  type SessionStateUpdater,
  GAME_SESSION_SELECT_COLUMNS,
} from '../types/session';

import { useTelemetry } from '@/hooks/use-telemetry';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export type { ExtendedGameSession, SessionState, SessionStateUpdater };

type ToastFn = (options: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive';
}) => void;

/**
 * React hook for managing game sessions.
 */
export const useGameSession = (
  campaignId?: string,
  characterId?: string,
): {
  sessionData: ExtendedGameSession | null;
  setSessionData: (data: ExtendedGameSession | null) => void;
  sessionId: string | null;
  sessionState: SessionState;
  updateGameSessionState: (newState: Partial<ExtendedGameSession>) => Promise<void>;
  createGameSession: (campId: string, charId: string) => Promise<string | null>;
  isSessionReady: () => boolean;
} => {
  const [sessionData, setSessionData] = useState<ExtendedGameSession | null>(null);
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const { toast } = useToast();
  const currentSessionId = sessionData?.id || null;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useTelemetry({
    sessionId: currentSessionId || undefined,
    enableHeartbeat: !!currentSessionId,
    heartbeatInterval: 30000,
  });

  const safeSetSessionData = useCallback((data: ExtendedGameSession | null): void => {
    if (data === null) {
      setSessionData(null);
      return;
    }
    if (!isValidSession(data)) {
      logger.warn('⚠️ [safeSetSessionData] Attempted to set invalid session data', {
        providedData: data,
      });
      return;
    }
    setSessionData(data);
  }, []);

  const isSessionReady = useCallback(
    (): boolean => !!(sessionData?.id && sessionState === 'active'),
    [sessionData, sessionState],
  );

  const toastRef = useRef<ToastFn>(toast as unknown as ToastFn);
  useEffect(() => {
    toastRef.current = toast as unknown as ToastFn;
  }, [toast]);

  const createGameSession = useCallback(
    async (campId: string, charId: string): Promise<string | null> => {
      if (!campId || !charId) {
        toastRef.current({
          title: 'Error',
          description: 'Campaign or Character ID missing',
          variant: 'destructive',
        });
        if (mountedRef.current) setSessionState('error');
        return null;
      }
      if (mountedRef.current) setSessionState('loading');

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
          },
        ])
        .select(GAME_SESSION_SELECT_COLUMNS)
        .single();

      if (!mountedRef.current) return null;
      if (error) {
        logger.error('[createGameSession] Error:', error);
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
      return data.id;
    },
    [],
  );

  const cleanupSession = useCallback(async (sessionIdToClean: string): Promise<string> => {
    if (!sessionIdToClean) return 'No activity recorded';
    if (mountedRef.current) setSessionState('ending');

    const summary = await generateSessionSummary(sessionIdToClean);
    if (!mountedRef.current) return summary;

    const { error } = await supabase
      .from('game_sessions')
      .update({
        end_time: new Date().toISOString(),
        summary,
        status: 'completed' as const,
      })
      .eq('id', sessionIdToClean);

    if (!mountedRef.current) return summary;
    if (error) {
      toastRef.current({
        title: 'Error',
        description: 'Failed to cleanup session',
        variant: 'destructive',
      });
    } else {
      setSessionState('expired');
      setSessionData((prev) =>
        prev && prev.id === sessionIdToClean
          ? { ...prev, status: 'completed', end_time: new Date().toISOString(), summary }
          : prev,
      );
    }
    return summary;
  }, []);

  const updateGameSessionState = useCallback(
    async (newState: Partial<ExtendedGameSession>): Promise<void> => {
      if (
        !newState ||
        typeof newState !== 'object' ||
        'id' in newState ||
        Object.keys(newState).length === 0
      )
        return;

      let sessId: string | null = null;
      let currentState: SessionState = 'idle';

      setSessionData((prev) => {
        if (prev && isValidSession(prev)) {
          sessId = prev.id;
          return { ...prev, ...newState };
        }
        return prev;
      });

      setSessionState((prev) => {
        currentState = prev;
        return prev;
      });

      if (!sessId || currentState === 'loading' || currentState === 'error' || !mountedRef.current)
        return;

      const { data, error } = await supabase
        .from('game_sessions')
        .update(newState)
        .eq('id', sessId)
        .select(GAME_SESSION_SELECT_COLUMNS)
        .single();
      if (!mountedRef.current) return;

      if (error) {
        toastRef.current({
          title: 'Error',
          description: 'Failed to save game state',
          variant: 'destructive',
        });
      } else if (data) {
        setSessionData(data as ExtendedGameSession);
      }
    },
    [],
  );

  useSessionInitialization({
    campaignId,
    characterId,
    setSessionData,
    setSessionState,
    createGameSession,
    cleanupSession,
    toastRef,
    mountedRef,
  });

  useEffect(() => {
    const cleanupIntervalId = setInterval(async () => {
      if (!mountedRef.current) return;
      setSessionData((currentSession) => {
        if (!isValidSession(currentSession) || currentSession.status !== 'active')
          return currentSession;
        if (isSessionExpired(currentSession)) {
          cleanupSession(currentSession.id).catch((err) =>
            logger.error('[Periodic Cleanup] Error:', err),
          );
        }
        return currentSession;
      });
    }, CLEANUP_INTERVAL);
    return () => clearInterval(cleanupIntervalId);
  }, [cleanupSession]);

  return {
    sessionData,
    setSessionData: safeSetSessionData,
    sessionId: currentSessionId,
    sessionState,
    updateGameSessionState,
    createGameSession,
    isSessionReady,
  };
};
