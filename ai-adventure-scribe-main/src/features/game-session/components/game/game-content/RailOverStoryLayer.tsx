import React, { useEffect, useRef } from 'react';

import { Z_INDEX } from '@/constants/z-index';
import { useSheetCastProgress, type SheetCastPhase } from '@/services/combat/sheet-cast-progress';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface RailOverStoryLayerProps {
  onClose: () => void;
  /** The character sheet is the content, so its height follows the cast. The campaign rail keeps the idle height. */
  sizeByCast?: boolean;
  children: React.ReactNode;
}

/**
 * How much of the story box the bottom sheet takes (#2418): the sheet when nothing is casting, a
 * cast in flight (sent, or resolving), the target-saves card, and the result. The rest is the feed,
 * so the newest engine card stays visible above the sheet in every stage.
 */
const SHEET_HEIGHT_PERCENT: Record<SheetCastPhase | 'idle', number> = {
  idle: 68,
  dm: 42,
  resolving: 42,
  save: 36,
  roll: 36,
  done: 58,
};

/**
 * A rail opened on a narrow screen, as a bottom sheet in the story box (#2281, #2418). It sits in
 * the box's flow rather than over it, so the feed above shrinks to what is left and keeps its
 * newest card in view. Opening it moves focus to its first control; Escape closes it and gives
 * focus back to whatever opened it.
 */
export const RailOverStoryLayer: React.FC<RailOverStoryLayerProps> = ({
  onClose,
  sizeByCast = true,
  children,
}) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const { cast } = useSheetCastProgress();
  const stage = (sizeByCast && cast?.phase) || 'idle';

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const layer = layerRef.current;
    const first = layer?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? layer)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      ref={layerRef}
      tabIndex={-1}
      data-testid="rail-over-story"
      data-stage={stage}
      className="relative shrink-0 overflow-y-auto rounded-t-xl border-t border-infinite-gold/30 bg-infinite-dark/95 shadow-[0_-8px_24px_rgba(0,0,0,0.4)] backdrop-blur-sm outline-none"
      style={{ zIndex: Z_INDEX.CARD_HOVER, height: `${SHEET_HEIGHT_PERCENT[stage]}%` }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
};
