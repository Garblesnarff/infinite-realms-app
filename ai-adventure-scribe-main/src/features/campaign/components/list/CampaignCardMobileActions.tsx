import { Play } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';

interface CampaignCardMobileActionsProps {
  campaignName: string;
  onPlay: () => void;
  onEnter: () => void;
}

export const CampaignCardMobileActions: React.FC<CampaignCardMobileActionsProps> = ({
  campaignName,
  onPlay,
  onEnter,
}) => (
  <div
    className="absolute bottom-3 left-3 flex gap-2 md:hidden"
    style={{ zIndex: Z_INDEX.CARD_HOVER }}
  >
    <Button
      size="sm"
      className="bg-infinite-gold text-infinite-dark hover:bg-infinite-purple"
      aria-label={`Play campaign: ${campaignName}`}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
    >
      <Play className="w-4 h-4" />
      Play
    </Button>
    <Button
      size="sm"
      variant="outline"
      className="border-infinite-teal text-infinite-teal hover:bg-infinite-teal hover:text-infinite-dark"
      aria-label={`Enter campaign: ${campaignName}`}
      onClick={(e) => {
        e.stopPropagation();
        onEnter();
      }}
    >
      Enter
    </Button>
  </div>
);
