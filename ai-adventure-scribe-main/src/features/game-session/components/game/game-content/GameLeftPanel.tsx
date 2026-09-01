import React, { memo } from 'react';

import { LeftRailLive } from '../overhaul/LeftRailLive';

/**
 * GameLeftPanel Component
 *
 * Wrapper for the left sidebar. Renders the navy+gold overhaul left rail
 * (Current Campaign / Objective / Region Map / Party / Encounter Tracker).
 */

interface GameLeftPanelProps {
  sessionId: string;
  isCollapsed: boolean;
  onToggle: () => void;
  chapterLabel?: string;
}

export const GameLeftPanel: React.FC<GameLeftPanelProps> = memo(
  ({ sessionId, isCollapsed, chapterLabel }) => {
    if (isCollapsed) return null;

    return (
      <div className="order-1 md:order-1 w-full md:w-auto min-h-0 h-full">
        <LeftRailLive sessionId={sessionId} chapterLabel={chapterLabel} />
      </div>
    );
  },
);

GameLeftPanel.displayName = 'GameLeftPanel';
