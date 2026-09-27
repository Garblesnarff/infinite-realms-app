import { useCallback, useState } from 'react';

import { useLocalStorage } from '@/hooks/use-local-storage';
import { useMediaQuery } from '@/hooks/use-media-query';

/** Both rails fit beside the story as columns from here up (the lg grid in GameLayout). */
export const RAILS_SIDE_BY_SIDE = '(min-width: 1024px)';
/** Below md one rail no longer fits beside the story as a column; it opens over the story. */
export const RAIL_OVER_STORY = '(max-width: 767px)';

type CollapsedUpdate = boolean | ((prev: boolean) => boolean);
type Rail = 'left' | 'right';

export interface GameRails {
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  setIsLeftCollapsed: (v: CollapsedUpdate) => void;
  setIsRightCollapsed: (v: CollapsedUpdate) => void;
}

/**
 * Open/closed state of the campaign rail (left) and the character sheet (right).
 *
 * On a wide screen both rails remember their state in localStorage. Below
 * RAILS_SIDE_BY_SIDE the game always opens with both closed and at most one is open at a
 * time, kept in memory only: a remembered "open" from a wide window put the sheet over the
 * chat box at 665 px (#2281), and two open rails can't share a narrow screen with the story.
 */
export function useGameRails(): GameRails {
  const wide = useMediaQuery(RAILS_SIDE_BY_SIDE);
  const [storedLeft, setStoredLeft] = useLocalStorage('ui:leftPanelCollapsed:v2', !wide);
  const [storedRight, setStoredRight] = useLocalStorage('ui:rightPanelCollapsed:v2', !wide);
  const [narrowOpen, setNarrowOpen] = useState<Rail | null>(null);

  const setNarrow = useCallback((rail: Rail, v: CollapsedUpdate): void => {
    setNarrowOpen((open) => {
      const collapsed = typeof v === 'function' ? v(open !== rail) : v;
      if (!collapsed) return rail;
      return open === rail ? null : open;
    });
  }, []);

  const setIsLeftCollapsed = useCallback(
    (v: CollapsedUpdate): void => (wide ? setStoredLeft(v) : setNarrow('left', v)),
    [wide, setStoredLeft, setNarrow],
  );
  const setIsRightCollapsed = useCallback(
    (v: CollapsedUpdate): void => (wide ? setStoredRight(v) : setNarrow('right', v)),
    [wide, setStoredRight, setNarrow],
  );

  return {
    isLeftCollapsed: wide ? storedLeft : narrowOpen !== 'left',
    isRightCollapsed: wide ? storedRight : narrowOpen !== 'right',
    setIsLeftCollapsed,
    setIsRightCollapsed,
  };
}
