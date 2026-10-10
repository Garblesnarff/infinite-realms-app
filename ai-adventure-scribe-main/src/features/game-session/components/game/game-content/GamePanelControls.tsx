import React, { memo } from 'react';

import { GameFeedbackButton } from './GameFeedbackButton';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * GamePanelControls Component
 *
 * Provides toggle buttons for controlling panel visibility (campaign, character, scene blurb).
 * Handles responsive layout adjustments.
 */

interface GamePanelControlsProps {
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  showSceneBlurb: boolean;
  onLeftToggle: () => void;
  onRightToggle: () => void;
  onSceneBlurbToggle: () => void;
}

export const GamePanelControls: React.FC<GamePanelControlsProps> = memo(
  ({
    isLeftCollapsed,
    isRightCollapsed,
    showSceneBlurb,
    onLeftToggle,
    onRightToggle,
    onSceneBlurbToggle,
  }) => {
    return (
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ir-hit"
              onClick={onLeftToggle}
              aria-pressed={!isLeftCollapsed}
            >
              {isLeftCollapsed ? 'Show Campaign' : 'Hide Campaign'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isLeftCollapsed ? 'Show' : 'Hide'} campaign panel</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ir-hit"
              onClick={onRightToggle}
              aria-pressed={!isRightCollapsed}
            >
              {isRightCollapsed ? 'Show Character' : 'Hide Character'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isRightCollapsed ? 'Show' : 'Hide'} character panel</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ir-hit"
              onClick={onSceneBlurbToggle}
              aria-pressed={showSceneBlurb}
            >
              {showSceneBlurb ? 'Hide Blurb' : 'Show Blurb'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{showSceneBlurb ? 'Hide' : 'Show'} scene blurb</p>
          </TooltipContent>
        </Tooltip>

        <GameFeedbackButton />
      </div>
    );
  },
);

GamePanelControls.displayName = 'GamePanelControls';
