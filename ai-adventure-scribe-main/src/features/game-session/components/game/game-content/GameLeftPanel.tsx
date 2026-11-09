import React, { memo, useState } from 'react';

import { TacticalMapBoard } from '../../tactical/TacticalMapBoard';
import { useTacticalMapContext } from '../../tactical/TacticalMapProvider';
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
  tableLook?: boolean;
  onToggle: () => void;
  onOpenSheet: () => void;
  chapterLabel?: string;
  /** Render the tactical map at the top of the rail (the layout decides; see GameLayout). */
  showMap?: boolean;
}

export const GameLeftPanel: React.FC<GameLeftPanelProps> = memo(
  ({ sessionId, isCollapsed, tableLook = false, chapterLabel, onOpenSheet, showMap = false }) => {
    const [mapExpanded, setMapExpanded] = useState(false);
    const tactical = useTacticalMapContext();
    if (isCollapsed) return null;

    const map = tableLook ? (
      <section
        key="map"
        data-testid="table-map-tile"
        role={mapExpanded ? 'dialog' : undefined}
        aria-label={mapExpanded ? 'Tactical map' : undefined}
        aria-modal={mapExpanded ? false : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMapExpanded(false);
        }}
        className={
          mapExpanded
            ? 'fixed inset-4 z-50 overflow-y-auto rounded-xl border-2 border-[#a9823f] bg-[#0c1322] p-3 text-[#f6e3b8]'
            : 'hidden rounded-xl border border-[#a9823f] bg-[#0c1322] p-3 text-[#f6e3b8] lg:block'
        }
      >
        <h2 className="font-heading font-bold">Map</h2>
        {showMap && tactical?.map ? (
          <>
            <TacticalMapBoard
              sessionId={sessionId}
              canvasClassName={mapExpanded ? 'h-[min(70vh,640px)]' : 'h-auto aspect-square'}
            />
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => setMapExpanded((expanded) => !expanded)}
            >
              {mapExpanded ? 'Close full map' : 'Open full map →'}
            </button>
          </>
        ) : (
          <p>Map unavailable</p>
        )}
      </section>
    ) : showMap ? (
      <TacticalMapBoard key="map" sessionId={sessionId} canvasClassName="h-auto aspect-square" />
    ) : null;
    const rail = (
      <div key="rail" className={tableLook ? 'min-h-0' : 'min-h-0 flex-1'}>
        <LeftRailLive sessionId={sessionId} chapterLabel={chapterLabel} onOpenSheet={onOpenSheet} />
      </div>
    );
    return (
      <div
        className={`order-1 md:order-1 w-full md:w-auto min-h-0 h-full flex flex-col gap-3 ${tableLook ? 'overflow-y-auto' : ''}`}
      >
        {tableLook ? [rail, map] : [map, rail]}
      </div>
    );
  },
);

GameLeftPanel.displayName = 'GameLeftPanel';
