import React, { memo } from 'react';

import { GameFeedbackButton } from './GameFeedbackButton';
import { GameChronicleButton } from '../chronicle/GameChronicleButton';

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
  sessionId?: string | null;
}

export const GamePanelControls: React.FC<GamePanelControlsProps> = memo(
  ({
    isLeftCollapsed,
    isRightCollapsed,
    showSceneBlurb,
    onLeftToggle,
    onRightToggle,
    onSceneBlurbToggle,
    sessionId,
  }) => {
    return (
      <div className="flex max-w-full min-w-0 items-center gap-2 overflow-x-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ir-hit shrink-0"
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
              className="ir-hit shrink-0"
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
              className="ir-hit shrink-0"
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

        <GameChronicleButton sessionId={sessionId} />
        <GameFeedbackButton />
      </div>
    );
  },
);

GamePanelControls.displayName = 'GamePanelControls';
