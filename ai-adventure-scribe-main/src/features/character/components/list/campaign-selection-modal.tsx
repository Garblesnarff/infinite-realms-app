import React from 'react';
import { useNavigate } from 'react-router-dom';

import CampaignCard from './campaign-card';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import CampaignsLoadError from '@/features/campaign/components/list/campaigns-load-error';
import {
  type CampaignListRow,
  useCampaignsList,
} from '@/features/campaign/hooks/use-campaigns-list';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

const selectActiveCampaigns = (campaigns: CampaignListRow[]): CampaignListRow[] =>
  campaigns.filter((campaign) => campaign.status === 'active');

interface CampaignSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  characterId: string;
}

/**
 * Modal component for selecting a campaign to play with a character
 * @param isOpen - Controls modal visibility
 * @param onClose - Callback to close modal
 * @param characterId - ID of the selected character
 */
const CampaignSelectionModal: React.FC<CampaignSelectionModalProps> = ({
  isOpen,
  onClose,
  characterId,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Every character card mounts this modal closed, so the request waits until
  // it opens and shares the user's campaigns cache entry (#2149).
  const {
    data: campaigns,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useCampaignsList({ enabled: isOpen, select: selectActiveCampaigns });

  /**
   * Handles starting a game session.
   *
   * #1355: Play must continue the pair's existing playthrough, not always
   * start a fresh one. A create with no session_number lands as session 1
   * (buildSessionInsertValues defaults it), so the game route never offers
   * the saved playthrough and the "Rest first?" gate (session_number > 1)
   * never fires. Before creating, page the pair's sessions:
   * - an active session resumes exactly (creating would retire it
   *   server-side);
   * - a completed session continues through the game route, which creates
   *   the N+1 continuation itself — the same path premade Play-as uses —
   *   so "Rest first?" fires below max HP. The chain's starter link rides
   *   along when the latest completed row carries one.
   * - no sessions at all keeps the old create + hub navigation.
   * A failed session read fails closed with a toast and no create: creating
   * blind would strand the unread playthrough behind a fresh session 1.
   */
  const handleStartSession = async (campaignId: string): Promise<void> => {
    try {
      const sessions: unknown[] = [];
      const pageSize = 100;
      for (let offset = 0; ; offset += pageSize) {
        const page = await userDataApi.listSessions({
          campaignId,
          characterId,
          limit: pageSize,
          offset,
        });
        sessions.push(...page);
        if (page.length < pageSize) break;
      }
      const asRecord = (value: unknown): Record<string, unknown> | null =>
        typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
      const rows = sessions
        .map(asRecord)
        .filter((row): row is Record<string, unknown> => row !== null)
        // Highest session number first: the chain's latest row carries the
        // starter link, whatever order the list endpoint returns.
        .sort(
          (a, b) =>
            (typeof b.session_number === 'number' ? b.session_number : 0) -
            (typeof a.session_number === 'number' ? a.session_number : 0),
        );
      const active = rows.find((row) => row.status === 'active');
      if (active && typeof active.id === 'string') {
        navigate(`/app/game/${campaignId}?character=${characterId}&session=${active.id}`);
        return;
      }
      const completed = rows.find((row) => row.status === 'completed');
      if (completed) {
        const starter =
          typeof completed.starter_campaign_id === 'string' &&
          completed.starter_campaign_id.length > 0
            ? `&starterCampaign=${encodeURIComponent(completed.starter_campaign_id)}`
            : '';
        navigate(`/app/game/${campaignId}?character=${characterId}${starter}`);
        return;
      }
    } catch (error) {
      logger.error('Error finding existing sessions:', error);
      toast({
        title: 'Error',
        description: 'Could not find your saved playthrough. Try again.',
        variant: 'destructive',
      });
      return;
    }

    try {
      logger.info('Starting session with character:', characterId);

      // Create new game session
      const session = await userDataApi.createSession({
        campaign_id: campaignId,
        character_id: characterId,
        status: 'active',
      });

      toast({
        title: 'Session Started',
        description: 'Your game session has begun!',
      });

      // Navigate to campaign hub with character and session IDs
      navigate(`/app/campaigns/${campaignId}?session=${session.id}&character=${characterId}`);
    } catch (error) {
      logger.error('Error starting session:', error);
      toast({
        title: 'Error',
        description: 'Failed to start game session',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg w-full max-h-[80vh] p-6 rounded-lg shadow-lg bg-card overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose a Campaign</DialogTitle>
          <DialogDescription>Select an active campaign to begin your adventure</DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <CampaignsLoadError onRetry={() => void refetch()} isRetrying={isFetching} />
          ) : campaigns?.length ? (
            <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
              {campaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} onSelect={handleStartSession} />
              ))}
            </div>
          ) : (
            <EmptyState
              illustration="no-campaigns"
              title="No Campaigns Available"
              description="There are no active campaigns available for your character at the moment."
              variant="minimal"
              className="py-12"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CampaignSelectionModal;
