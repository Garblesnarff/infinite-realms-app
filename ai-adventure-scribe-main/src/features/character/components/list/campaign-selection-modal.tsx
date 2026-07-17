import { useQuery } from '@tanstack/react-query';
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
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

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

  // Fetch available campaigns
  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['available-campaigns', characterId],
    queryFn: async () => {
      // Only select minimal fields needed for campaign selection
      // Excludes heavy JSONB fields (setting_details, thematic_elements, style_config, rules_config)
      const data = await userDataApi.listCampaigns();
      return data.filter((campaign) => campaign.status === 'active');
    },
  });

  /**
   * Handles starting a new game session
   * Creates session and navigates to campaign view
   */
  const handleStartSession = async (campaignId: string) => {
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
      <DialogContent className="max-w-lg w-full max-h-[80vh] p-6 rounded-lg shadow-lg bg-white overflow-y-auto">
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
