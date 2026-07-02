/**
 * Session resume/continue logic, split out of CampaignSessions.tsx's
 * handleContinue.
 *
 * RESUME (active sessions that are not expired):
 * - Simply navigates to the game with the existing session
 * - No new session is created
 * - User picks up exactly where they left off
 *
 * CONTINUE (completed or expired sessions):
 * - Creates a NEW continuation session
 * - Increments session_number
 * - Carries over scene description from previous session
 * - Links to the same character and campaign
 * - Resets turn_count to 0
 */

import { type SessionListItem } from './SessionCard';

import type { QueryClient } from '@tanstack/react-query';
import type { NavigateFunction } from 'react-router-dom';

import { type useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

interface ContinueOrResumeSessionParams {
  session: SessionListItem;
  campaignId: string;
  isExpired: boolean;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  toast: ReturnType<typeof useToast>['toast'];
  setContinuingId: (id: string | null) => void;
}

export async function continueOrResumeSession({
  session,
  campaignId,
  isExpired,
  navigate,
  queryClient,
  toast,
  setContinuingId,
}: ContinueOrResumeSessionParams): Promise<void> {
  if (!session.character?.id) {
    toast({
      title: 'Character required',
      description: 'This session is missing a character link. Please reassign before continuing.',
      variant: 'destructive',
    });
    return;
  }

  // Debug logging
  logger.info('[CampaignSessions] handleContinue called', {
    sessionId: session.id,
    sessionNumber: session.session_number,
    status: session.status,
    expired: isExpired,
    shouldResume: session.status === 'active' && !isExpired,
  });

  // RESUME: Active session that is not expired
  // Navigate to game without creating a new session
  // Pass sessionId to ensure we load THIS specific session, not just the most recent one
  if (session.status === 'active' && !isExpired) {
    logger.info('[CampaignSessions] RESUMING - navigating without creating new session');
    navigate(`/app/game/${campaignId}?character=${session.character.id}&session=${session.id}`);
    return;
  }

  // CONTINUE: Completed or expired session
  // Create a new continuation session with incremented session_number
  logger.info('[CampaignSessions] CONTINUING - creating new session');
  setContinuingId(session.id);

  try {
    const { data: newSession, error: createError } = await supabase
      .from('game_sessions')
      .insert({
        campaign_id: campaignId,
        character_id: session.character.id,
        status: 'active',
        session_number: (session.session_number ?? 0) + 1,
        current_scene_description:
          session.current_scene_description ?? 'Continuing your adventure...',
        session_notes: session.summary
          ? `Continuing from Session ${session.session_number ?? ''}`
          : null,
        turn_count: 0,
        start_time: new Date().toISOString(),
      })
      .select()
      .single();

    if (createError || !newSession) {
      throw createError || new Error('Failed to create continuation session.');
    }

    const createdSession = newSession as SessionListItem;

    toast({
      title: 'Session ready',
      description: createdSession.session_number
        ? `Session ${createdSession.session_number} created.`
        : 'New session created.',
    });

    await queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'sessions'] });
    navigate(`/app/game/${campaignId}?character=${session.character?.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to continue session.';
    toast({
      title: 'Session continuation failed',
      description: message,
      variant: 'destructive',
    });
  } finally {
    setContinuingId(null);
  }
}
