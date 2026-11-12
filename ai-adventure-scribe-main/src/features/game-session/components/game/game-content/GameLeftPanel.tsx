import React, { memo, useState } from 'react';

import { TacticalMapBoard } from '../../tactical/TacticalMapBoard';
import { useTacticalMapContext } from '../../tactical/TacticalMapProvider';
import { LeftRailLive } from '../overhaul/LeftRailLive';

import type { TacticalMap } from '../../tactical/tactical-map-state';

import { useOptionalCombat } from '@/contexts/CombatContext';
import '@/styles/ir-table-parts.css';

/** Ink for each terrain in the chat-mode sketch. Walls read as solid ink, water as a wash. */
const TERRAIN_INK: Record<string, string> = {
  wall: '#2a1a0c',
  door_closed: '#7a4e1c',
  door_open: '#b8864a',
  difficult: '#8a6a3c',
  water: '#7d97a6',
  pit: '#1d1409',
  obscured: '#9a8a6a',
};

/**
 * The chat-mode map: the same tactical map data as the battle grid, drawn as a parchment
 * sketch with ink lines. It reads the map that already exists; nothing is invented.
 */
const MapSketch: React.FC<{ map: TacticalMap }> = ({ map }) => {
  const cells = Array.isArray(map.cells) ? map.cells : [];
  const rows = cells.length;
  const cols = rows > 0 && Array.isArray(cells[0]) ? cells[0].length : 0;
  return (
    <div className="ir-map-sketch">
      <p className="ir-map-sketch-label">MAP SKETCH</p>
      {rows > 0 && cols > 0 ? (
        <svg
          viewBox={`0 0 ${cols} ${rows}`}
          className="block h-auto w-full"
          role="img"
          aria-label="Map sketch"
          shapeRendering="crispEdges"
        >
          {cells.flatMap((row, y) =>
            (Array.isArray(row) ? row : []).map((cell, x) => {
              const ink = TERRAIN_INK[cell?.terrain ?? 'floor'];
              return (
                <g key={`${x}-${y}`}>
                  <rect
                    x={x}
                    y={y}
                    width={1}
                    height={1}
                    fill="none"
                    stroke="#5a4226"
                    strokeOpacity={0.25}
                    strokeWidth={0.04}
                  />
                  {ink ? (
                    <rect
                      x={x + 0.08}
                      y={y + 0.08}
                      width={0.84}
                      height={0.84}
                      fill={ink}
                      fillOpacity={cell?.terrain === 'wall' ? 0.9 : 0.35}
                    />
                  ) : null}
                </g>
              );
            }),
          )}
          {(map.entities ?? []).map((entity) => (
            <circle
              key={entity.id}
              cx={entity.x + 0.5}
              cy={entity.y + 0.5}
              r={0.3}
              fill={entity.type === 'pc' ? '#1f3f7a' : '#7a1016'}
              stroke="#2a1a0c"
              strokeWidth={0.06}
            />
          ))}
        </svg>
      ) : (
        <p className="text-sm">No map drawn yet.</p>
      )}
      {map.sceneDescription ? (
        <p className="ir-map-sketch-caption">{map.sceneDescription}</p>
      ) : null}
    </div>
  );
};

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
    const inCombat = useOptionalCombat()?.state.isInCombat ?? false;
    if (isCollapsed) return null;

    // Combat keeps the battle grid. Outside combat (chat mode) the same map data shows as a sketch.
    // The grid is gated on combat alone, not on showMap: the layout only shows this tile when
    // the rail is open on desktop (GameLayout mapInRail), so showMap is true whenever the tile
    // is visible — gating on it showed the grid in chat mode and the sketch never (#1487).
    const showBattleGrid = inCombat;
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
        {!showBattleGrid && tactical?.map ? (
          <MapSketch map={tactical.map} />
        ) : (
          <>
            <h2 className="font-heading font-bold">Map</h2>
            {showBattleGrid && tactical?.map ? (
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
          </>
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
