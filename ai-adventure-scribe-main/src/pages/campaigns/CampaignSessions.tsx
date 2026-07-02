import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { CampaignSessionsContent } from './CampaignSessionsContent';
import { continueOrResumeSession } from './continue-or-resume-session';

import type { SessionListItem } from './SessionCard';

import ChronicleViewer from '@/components/chronicles/ChronicleViewer';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { trpc } from '@/infrastructure/api';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

const PAGE_SIZE = 10;
// Session expiry times
// Free tier: 7 days
// Paid tier: 6 months (182 days)
const FREE_SESSION_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7;
const PAID_SESSION_EXPIRY_MS = 1000 * 60 * 60 * 24 * 182;

const CampaignSessions: React.FC = () => {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { userPlan } = useAuth();

  const sessionExpiryMs =
    userPlan && userPlan !== 'free' ? PAID_SESSION_EXPIRY_MS : FREE_SESSION_EXPIRY_MS;

  const isSessionExpired = React.useCallback(
    (session: SessionListItem) => {
      const start = session.start_time || session.created_at;
      if (!start) return false;
      const startTime = new Date(start).getTime();
      return Number.isFinite(startTime) ? Date.now() - startTime > sessionExpiryMs : false;
    },
    [sessionExpiryMs],
  );
  const [continuingId, setContinuingId] = React.useState<string | null>(null);
  const [chronicleSessionId, setChronicleSessionId] = React.useState<string | null>(null);

  const generateChronicle = trpc.chronicles.generate.useMutation();

  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage, error } =
    useInfiniteQuery({
      queryKey: ['campaign', campaignId, 'sessions'],
      queryFn: async ({ pageParam = 0 }): Promise<SessionListItem[]> => {
        if (!campaignId) return [];
        const from = pageParam * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        const { data: rows, error: fetchError } = await supabase
          .from('game_sessions')
          .select(
            `
          id,
          session_number,
          status,
          start_time,
          end_time,
          summary,
          current_scene_description,
          turn_count,
          created_at,
          character:characters ( id, name, image_url ),
          session_chronicles ( id, status, chapter_title, share_token )
        `,
          )
          .eq('campaign_id', campaignId)
          .order('created_at', { ascending: false })
          .range(from, to);

        if (fetchError) {
          throw fetchError;
        }

        logger.debug('[CampaignSessions] Query results', {
          campaignId,
          pageParam,
          rowCount: rows?.length ?? 0,
        });

        return (rows ?? []) as SessionListItem[];
      },
      getNextPageParam: (lastPage, pages) =>
        lastPage.length === PAGE_SIZE ? pages.length : undefined,
      enabled: Boolean(campaignId),
    });

  const sessions = React.useMemo(() => {
    const flattened = data?.pages ? data.pages.flat() : [];
    logger.debug('[CampaignSessions] Flattened sessions', {
      pageCount: data?.pages?.length ?? 0,
      totalSessions: flattened.length,
    });
    return flattened;
  }, [data?.pages]);

  React.useEffect(() => {
    if (!campaignId) return;
    const channel = supabase
      .channel(`campaign-sessions-${campaignId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'game_sessions',
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['campaign', campaignId, 'sessions'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, queryClient]);

  const openStartSession = React.useCallback(() => {
    if (!campaignId) {
      toast({
        title: 'Campaign not found',
        description: 'Select a campaign before starting a session.',
        variant: 'destructive',
      });
      return;
    }

    const params = new URLSearchParams(location.search);
    params.set('startSession', 'true');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' });
  }, [campaignId, location.pathname, location.search, navigate, toast]);

  /**
   * Handles both resuming active sessions and continuing completed sessions.
   * See continue-or-resume-session.ts for the resume/continue branching logic.
   */
  const handleContinue = React.useCallback(
    async (session: SessionListItem) => {
      if (!campaignId) return;

      const isExpired = isSessionExpired(session) || session.status === 'expired';

      await continueOrResumeSession({
        session,
        campaignId,
        isExpired,
        navigate,
        queryClient,
        toast,
        setContinuingId,
      });
    },
    [campaignId, navigate, queryClient, toast, isSessionExpired],
  );

  return (
    <div className="mt-4 space-y-4">
      <ChronicleViewer
        sessionId={chronicleSessionId}
        open={!!chronicleSessionId}
        onClose={() => setChronicleSessionId(null)}
      />
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Sessions</h2>
          <p className="text-muted-foreground text-sm">
            Review past sessions and continue your adventure right where you left off.
          </p>
        </div>
        <Button onClick={openStartSession} className="md:self-center">
          Start New Session
        </Button>
      </div>
      <CampaignSessionsContent
        isLoading={isLoading}
        error={error}
        sessions={sessions}
        openStartSession={openStartSession}
        isSessionExpired={isSessionExpired}
        handleContinue={handleContinue}
        continuingId={continuingId}
        onViewChronicle={(id) => setChronicleSessionId(id)}
        onGenerateChronicle={(id) => generateChronicle.mutate({ sessionId: id })}
        userPlan={userPlan ?? undefined}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        fetchNextPage={() => fetchNextPage()}
      />
    </div>
  );
};

export default CampaignSessions;
