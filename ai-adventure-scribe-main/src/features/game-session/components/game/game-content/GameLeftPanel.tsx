import React, { memo } from 'react';

import { TacticalMapBoard } from '../../tactical/TacticalMapBoard';
import { LeftRailLive } from '../overhaul/LeftRailLive';

/**
 * GameLeftPanel Component
 *
 * Wrapper for the left sidebar. Renders the navy+gold overhaul left rail
 * (Current Campaign / Objective / Region Map / Party / Encounter Tracker).
 * In a fight the tactical map sits on top of the rail, out of the center column, so it can
 * never cover the roll tray or the chat box (#2252).
 */

interface GameLeftPanelProps {
  sessionId: string;
  isCollapsed: boolean;
  onToggle: () => void;
  chapterLabel?: string;
  /** Render the tactical map at the top of the rail (the layout decides; see GameLayout). */
  showMap?: boolean;
}

export const GameLeftPanel: React.FC<GameLeftPanelProps> = memo(
  ({ sessionId, isCollapsed, chapterLabel, showMap = false }) => {
    if (isCollapsed) return null;

    return (
      <div className="order-1 md:order-1 w-full md:w-auto min-h-0 h-full flex flex-col gap-3">
        {showMap && (
          <TacticalMapBoard sessionId={sessionId} canvasClassName="h-auto aspect-square" />
        )}
        <div className="min-h-0 flex-1">
          <LeftRailLive sessionId={sessionId} chapterLabel={chapterLabel} />
        </div>
      </div>
    );
  },
);

GameLeftPanel.displayName = 'GameLeftPanel';
