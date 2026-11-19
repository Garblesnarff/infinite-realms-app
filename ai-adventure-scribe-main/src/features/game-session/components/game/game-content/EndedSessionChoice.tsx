import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import type { SessionListItem } from '@/pages/campaigns/SessionCard';

import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { continueOrResumeSession } from '@/pages/campaigns/continue-or-resume-session';
import { userDataApi } from '@/services/user-data-api';

/**
 * #1669: an ended session opened by its link. It is never replaced silently: the player picks
 * Start new session (a new session in this adventure, scene carried over) or Resume session
 * (this session, with its chat and story, reopened).
 */
export function EndedSessionChoice({
  sessionId,
  campaignId,
  characterId,
  sessionNumber,
  sceneDescription,
}: {
  sessionId: string;
  campaignId: string | null;
  characterId: string | null;
  sessionNumber: number | null;
  sceneDescription: string | null;
}): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<'new' | 'resume' | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function startNew(): Promise<void> {
    if (!campaignId || !characterId) return;
    setBusy('new');
    setError(null);
    await continueOrResumeSession({
      session: {
        id: sessionId,
        status: 'completed',
        session_number: sessionNumber,
        current_scene_description: sceneDescription,
        character: { id: characterId },
      } as SessionListItem,
      campaignId,
      isExpired: false,
      navigate,
      queryClient,
      toast,
      setContinuingId: (id) => setBusy(id ? 'new' : null),
    });
    setBusy(null);
  }

  async function resume(): Promise<void> {
    setBusy('resume');
    setError(null);
    try {
      await userDataApi.resumeSession(sessionId);
      // The same URL is already open, so reload it to load the reopened session.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume session.');
      setBusy(null);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="max-w-xl space-y-2">
        <h1 className="ir-display text-[24px] text-infinite-gold-light">This session has ended</h1>
        <p className="text-muted-foreground">
          Start new session begins a new session in this adventure, with the scene carried over.
          Resume session reopens this one, with its chat and its story so far.
        </p>
      </div>
      <div className="flex w-full max-w-sm flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void startNew()}
          disabled={busy !== null}
          className="min-h-11 w-full"
        >
          {busy === 'new' ? 'Starting...' : 'Start new session'}
        </Button>
        <Button
          type="button"
          onClick={() => void resume()}
          disabled={busy !== null}
          className="min-h-11 w-full"
        >
          {busy === 'resume' ? 'Resuming...' : 'Resume session'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
