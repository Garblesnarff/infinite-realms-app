import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { useTacticalMap } from './useTacticalMap';

import { useMediaQuery } from '@/hooks/use-media-query';

export type TacticalMapState = ReturnType<typeof useTacticalMap>;

// GameLayout's grid shows the left rail as its own column from these widths up.
const RAIL_COLUMN_WITH_RIGHT_OPEN = '(min-width: 1024px)';
const RAIL_COLUMN_WITH_RIGHT_CLOSED = '(min-width: 768px)';

const TacticalMapContext = createContext<TacticalMapState | null>(null);

/**
 * One owner for the tactical map state. The board can render in the left rail or in the
 * "Map" sheet (#2252); each placement mounts and unmounts as the layout changes, so the
 * fetch, the delta listener and the animation queue live here instead, above both.
 */
export function TacticalMapProvider({
  sessionId,
  setLeftCollapsed,
  children,
}: {
  sessionId: string;
  /** Lets a new fight's map open the left rail on desktop; see OpenRailForNewMap. */
  setLeftCollapsed?: (collapsed: boolean) => void;
  children: ReactNode;
}): JSX.Element {
  const state = useTacticalMap(sessionId);
  return (
    <TacticalMapContext.Provider value={state}>
      {setLeftCollapsed && <OpenRailForNewMap setLeftCollapsed={setLeftCollapsed} />}
      {children}
    </TacticalMapContext.Provider>
  );
}

/** The shared map state, or null outside a provider. */
export function useTacticalMapContext(): TacticalMapState | null {
  return useContext(TacticalMapContext);
}

/**
 * Whether the tactical map belongs in the left rail: only while the rail is open and is a
 * column of its own. Otherwise the center column offers a Map button (#2252).
 */
export function useMapInRail(isLeftCollapsed: boolean, isRightCollapsed: boolean): boolean {
  const railIsColumn = useMediaQuery(
    isRightCollapsed ? RAIL_COLUMN_WITH_RIGHT_CLOSED : RAIL_COLUMN_WITH_RIGHT_OPEN,
  );
  return !isLeftCollapsed && railIsColumn;
}

/**
 * Opens the left rail when a fight's map appears on a desktop-width screen, so the map is in
 * the rail rather than behind the Map button (#2252). Runs once per map, so a player who
 * closes the rail mid-fight keeps it closed.
 */
function OpenRailForNewMap({
  setLeftCollapsed,
}: {
  setLeftCollapsed: (collapsed: boolean) => void;
}): null {
  const mapId = useTacticalMapContext()?.map?.id ?? null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!mapId || mapId === openedFor) return;
    setOpenedFor(mapId);
    if (window.matchMedia?.(RAIL_COLUMN_WITH_RIGHT_OPEN).matches) setLeftCollapsed(false);
  }, [mapId, openedFor, setLeftCollapsed]);
  return null;
}
