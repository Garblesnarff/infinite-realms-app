import { useQueryClient } from '@tanstack/react-query';
import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { CampaignCardDeleteDialog } from './CampaignCardDeleteDialog';
import { CampaignCardHoverPopup } from './CampaignCardHoverPopup';
import { CampaignCardMobileActions } from './CampaignCardMobileActions';
import CharacterSelectionModal from './character-selection-modal';

import type { CampaignCardData } from './campaign-card-types';

import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaignImageHotLoading } from '@/hooks/use-image-hot-loading';
import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

interface CampaignCardProps {
  campaign: CampaignCardData;
  isFeatured?: boolean;
  coverImage?: string;
}

/**
 * CampaignCard component
 * Displays individual campaign information in a card format
 * @param campaign - Campaign data to display
 */
const CampaignCardComponent = ({
  campaign,
  isFeatured: _isFeatured = false,
  coverImage,
}: CampaignCardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCharacterModal, setShowCharacterModal] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Use hot loading hook for background image
  const {
    imageUrl: hotLoadedImage,
    isLoading: imageLoading,
    hasImage,
  } = useCampaignImageHotLoading(campaign.id);

  // Handle hover with delay
  const handleMouseEnter = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(true);
    }, 1000);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
  }, []);

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  /**
   * Handles campaign deletion confirmation
   * Shows delete dialog when user clicks delete button
   */
  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  /**
   * Handles actual campaign deletion
   * Removes campaign from database and updates UI
   */
  const handleDelete = useCallback(async () => {
    try {
      await userDataApi.deleteCampaign(campaign.id);

      toast({
        title: 'Campaign Deleted',
        description: 'The campaign has been successfully removed.',
      });

      setShowDeleteDialog(false);

      // Invalidate campaigns query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (error) {
      logger.error('Error deleting campaign:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete campaign. Please try again.',
        variant: 'destructive',
      });
      setShowDeleteDialog(false);
    }
  }, [campaign.id, toast, queryClient]);

  // Use hot loaded image, fallback to coverImage, then default
  const resolvedImage = useMemo(() => {
    // Priority: hot loaded image > static cover image > default background
    if (hasImage && hotLoadedImage && hotLoadedImage !== '/campaign-background-placeholder.png') {
      return hotLoadedImage;
    }

    if (coverImage) {
      return new URL(coverImage, import.meta.url).href;
    }

    // If we don't have an image and it's loading, show placeholder
    if (imageLoading || !hasImage) {
      return hotLoadedImage || '/campaign-background-placeholder.png'; // This will be the placeholder
    }

    return new URL('/card-background.jpeg', import.meta.url).href;
  }, [hotLoadedImage, hasImage, imageLoading, coverImage]);

  const goToCampaign = useCallback(
    () => navigate(`/app/campaigns/${campaign.id}`),
    [navigate, campaign.id],
  );

  return (
    <Card
      className="campaign-card featured-card group relative border-2 border-border/30 shadow-md transition-all duration-500 hover:shadow-2xl hover:shadow-infinite-purple/50 hover:border-infinite-gold aspect-square w-full"
      style={{ padding: '2px' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Glow effect on hover - uses OVERLAY_EFFECT for visual effects */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        <div className="absolute inset-0 shadow-inset-glow-purple" />
      </div>

      {/* Hero / thumbnail area */}
      <div
        className="campaign-hero featured flex items-end p-4 cursor-pointer h-full w-full bg-cover bg-center bg-no-repeat filter sepia-[0.1] relative bg-gray-500 overflow-hidden transition-all duration-700 ease-out group-hover:scale-[1.02] group-hover:brightness-110 rounded-sm"
        role="link"
        tabIndex={0}
        aria-label={`Open campaign ${campaign.name}`}
        onClick={goToCampaign}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            goToCampaign();
          }
        }}
        style={
          resolvedImage
            ? {
                backgroundImage: `url(${resolvedImage})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center center',
                backgroundColor: '#6b7280',
              }
            : { backgroundColor: '#6b7280' }
        }
      >
        {/* Loading overlay for image generation */}
        {imageLoading && !hasImage && (
          <div className="absolute inset-0 bg-gradient-to-br from-infinite-purple/20 via-infinite-dark/40 to-infinite-purple/20 backdrop-blur-sm flex items-center justify-center">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-infinite-gold mb-2"></div>
              <div className="text-xs text-infinite-gold font-medium">Generating image...</div>
            </div>
          </div>
        )}
        {/* Overlay and popup for all cards */}
        <div className="featured-overlay bg-gradient-to-b from-infinite-purple/80 via-transparent to-infinite-dark/90" />
        <CampaignCardHoverPopup
          campaign={campaign}
          isHovered={isHovered}
          imageLoading={imageLoading}
          onPlay={() => setShowCharacterModal(true)}
          onEnter={goToCampaign}
          onDeleteClick={handleDeleteClick}
        />

        <CampaignCardMobileActions
          campaignName={campaign.name}
          onPlay={() => setShowCharacterModal(true)}
          onEnter={goToCampaign}
        />
      </div>

      <CampaignCardDeleteDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        campaignName={campaign.name}
        onConfirmDelete={handleDelete}
      />

      <CharacterSelectionModal
        isOpen={showCharacterModal}
        onClose={() => setShowCharacterModal(false)}
        campaignId={campaign.id}
        campaignName={campaign.name}
      />
    </Card>
  );
};

const MemoizedCampaignCard = React.memo(CampaignCardComponent);

export { MemoizedCampaignCard };
export default CampaignCardComponent;
