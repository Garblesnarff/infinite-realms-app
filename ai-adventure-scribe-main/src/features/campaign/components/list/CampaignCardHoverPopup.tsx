import { Trash2, Play } from 'lucide-react';
import React from 'react';

import type { CampaignCardData } from './campaign-card-types';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';

interface CampaignCardHoverPopupProps {
  campaign: CampaignCardData;
  isHovered: boolean;
  imageLoading: boolean;
  onPlay: () => void;
  onEnter: () => void;
  onDeleteClick: () => void;
}

export const CampaignCardHoverPopup: React.FC<CampaignCardHoverPopupProps> = ({
  campaign,
  isHovered,
  imageLoading,
  onPlay,
  onEnter,
  onDeleteClick,
}) => (
  <div
    className={cn(
      'hover-popup absolute left-1/2 top-1/2 w-80 max-w-full filter drop-shadow-popup transition-all duration-200',
      isHovered ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
    )}
    style={{ zIndex: isHovered ? Z_INDEX.CARD_HOVER : undefined }}
  >
    <div className="bg-white/95 backdrop-blur-sm p-4 rounded-lg shadow-xl border border-border">
      <div className="text-xl font-bold text-foreground mb-2 leading-tight break-words">
        {imageLoading ? <Skeleton className="h-6 w-48" /> : campaign.name}
      </div>
      {imageLoading ? (
        <Skeleton className="h-4 w-full" />
      ) : (
        <>
          {logger.debug('Campaign description:', campaign.description)}
          <div className="description-section min-h-[3rem] max-h-[200px] overflow-y-auto text-sm text-foreground leading-relaxed mb-3 break-words hyphens-auto p-2 pr-3 scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-transparent">
            {campaign.description ? (
              campaign.description
            ) : (
              <span className="italic text-muted-foreground">
                No description yet. Enter the campaign to begin your adventure!
              </span>
            )}
          </div>
        </>
      )}

      {/* Campaign badges in popup */}
      <div className="campaign-badges flex gap-1 flex-wrap text-xs mt-2 mb-4">
        {campaign.genre && (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-infinite-purple/10 text-infinite-purple border border-infinite-purple/20 font-medium">
            {campaign.genre}
          </span>
        )}
        {campaign.difficulty_level && (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-destructive/10 text-destructive border border-destructive/20 font-medium">
            {campaign.difficulty_level}
          </span>
        )}
        {campaign.campaign_length && (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-secondary/10 text-secondary-foreground border border-secondary/20 font-medium">
            {campaign.campaign_length}
          </span>
        )}
        {campaign.tone && (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-accent/10 text-accent-foreground border border-accent/20 font-medium">
            {campaign.tone}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 justify-end">
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="bg-infinite-gold text-infinite-dark flex items-center gap-2 hover:bg-infinite-purple"
                aria-label={`Play campaign: ${campaign.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay();
                }}
              >
                <Play className="w-4 h-4" />
                Play
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Play campaign: {campaign.name}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-infinite-teal text-infinite-teal hover:bg-infinite-teal hover:text-infinite-dark"
                aria-label={`Enter campaign management: ${campaign.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onEnter();
                }}
              >
                Enter
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Enter campaign management: {campaign.name}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-infinite-dark/20"
                aria-label={`Delete campaign: ${campaign.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteClick();
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Delete campaign: {campaign.name}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  </div>
);
