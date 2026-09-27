import React, { useEffect, useRef } from 'react';

import { Z_INDEX } from '@/constants/z-index';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface RailOverStoryLayerProps {
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * A rail opened on a narrow screen, laid over the story box (#2281). Opening it moves focus
 * to its first control; Escape closes it and gives focus back to whatever opened it.
 */
export const RailOverStoryLayer: React.FC<RailOverStoryLayerProps> = ({ onClose, children }) => {
  const layerRef = useRef<HTMLDivElement>(null);

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
      className="absolute inset-0 overflow-y-auto bg-infinite-dark/95 backdrop-blur-sm outline-none"
      style={{ zIndex: Z_INDEX.CARD_HOVER }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
};
