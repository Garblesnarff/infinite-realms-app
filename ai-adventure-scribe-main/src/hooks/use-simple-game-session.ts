import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export interface GameSession {
  id: string;
  campaign_id: string;
  character_id: string;
  session_number: number | null;
  status: string;
  start_time: string;
  end_time?: string | null;
  current_scene_description?: string | null;
  summary?: string | null;
  session_notes?: string | null;
  starter_campaign_id?: string | null; // Links to starter_campaigns for pre-built adventures
  campaign_version?: number | null; // Locked version at session start
}

export const useSimpleGameSession = (campaignId?: string, characterId?: string) => {
  const { user } = useAuth();
  const [session, setSession] = useState<GameSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚡ Bolt: Memoized session creation to prevent unnecessary re-renders in consuming components.
   */
  const createGameSession = useCallback(
    async (campaignId: string, characterId: string) => {
      if (!user) {
        throw new Error('User must be authenticated');
      }

      setLoading(true);
      setError(null);

      try {
        // Get the next session number
        const { data: existingSessions, error: countError } = await supabase
          .from('game_sessions')
          .select('session_number')
          .eq('campaign_id', campaignId)
          .order('session_number', { ascending: false })
          .limit(1);

        if (countError) throw countError;

        const nextSessionNumber =
          existingSessions.length > 0 && existingSessions[0]?.session_number
            ? existingSessions[0].session_number + 1
            : 1;

        // Create new session
        const { data, error } = await supabase
          .from('game_sessions')
          .insert({
            campaign_id: campaignId,
            character_id: characterId,
            session_number: nextSessionNumber,
            status: 'active',
          })
          .select()
          .single();

        if (error) throw error;

        setSession(data as GameSession);
        return data as GameSession;
      } catch (err) {
        logger.error('Error creating game session:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [user],
  );

  /**
   * ⚡ Bolt: Explicit column selection in session discovery avoids over-fetching
   * while ensuring UI has all necessary data (description, notes) on resume.
   */
  const getActiveSession = useCallback(
    async (campaignId: string, characterId: string) => {
      setLoading(true);
      setError(null);

      try {
        // Look for existing sessions, both active and completed
        const { data: existingSessions, error } = await supabase
          .from('game_sessions')
          .select(
            'id, campaign_id, character_id, session_number, status, start_time, end_time, current_scene_description, summary, session_notes, starter_campaign_id, campaign_version',
          )
          .eq('campaign_id', campaignId)
          .eq('character_id', characterId)
          .order('created_at', { ascending: false })
          .limit(5); // Get last 5 sessions to find the best one to resume

        if (error) {
          logger.error('Error fetching existing sessions:', error);
          // If we can't fetch sessions, create a new one
          return await createGameSession(campaignId, characterId);
        }

        // Look for an active session first
        const sessionToResume = existingSessions?.find((s) => s.status === 'active');

        if (sessionToResume) {
          logger.info('📚 Resuming existing active session:', sessionToResume.id);
          setSession(sessionToResume as GameSession);
          return sessionToResume as GameSession;
        }

        // If no active session, look for the most recent completed session
        // and create a new session based on its state for continuity
        const lastCompletedSession = existingSessions?.find((s) => s.status === 'completed');

        if (lastCompletedSession) {
          logger.info(
            '📚 Creating new session continuing from previous session:',
            lastCompletedSession.id,
          );
          // Create a new session but maintain continuity from the last one
          const sessionNumber =
            Math.max(...(existingSessions?.map((s) => s.session_number || 1) || [1])) + 1;

          const { data: newSession, error: createError } = await supabase
            .from('game_sessions')
            .insert({
              campaign_id: campaignId,
              character_id: characterId,
              session_number: sessionNumber,
              status: 'active',
              // Add a summary note about continuity
              summary: `Continuing from Session ${lastCompletedSession.session_number || 1}`,
            })
            .select()
            .single();

          if (createError) throw createError;

          setSession(newSession as GameSession);
          return newSession as GameSession;
        }

        // No existing sessions found, create the first one
        logger.info('📚 No existing sessions found, creating first session');
        return await createGameSession(campaignId, characterId);
      } catch (err) {
        logger.error('Error getting active session:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to get session';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [createGameSession],
  );

  /**
   * ⚡ Bolt: Memoized session termination.
   */
  const endSession = useCallback(
    async (sessionId: string, summary?: string) => {
      try {
        const { error } = await supabase
          .from('game_sessions')
          .update({
            status: 'completed',
            end_time: new Date().toISOString(),
            summary: summary,
          })
          .eq('id', sessionId);

        if (error) throw error;

        if (session?.id === sessionId) {
          setSession({
            ...session,
            status: 'completed',
            end_time: new Date().toISOString(),
            summary,
          });
        }
      } catch (err) {
        logger.error('Error ending session:', err);
        const errorMessage = err instanceof Error ? err.message : 'Failed to end session';
        setError(errorMessage);
        throw err;
      }
    },
    [session],
  );

  // Auto-load session when campaign and character are available
  useEffect(() => {
    if (campaignId && characterId && user) {
      getActiveSession(campaignId, characterId).catch((err) => logger.error(err));
    }
  }, [campaignId, characterId, user]);

  return {
    session,
    loading,
    error,
    createGameSession,
    getActiveSession,
    endSession,
  };
};
