import React from 'react';

import { cn } from '@/lib/utils';

interface CampaignTitleOverlayProps {
  title: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Shared title treatment for campaign artwork.
 *
 * Campaign art may contain a generated title, but the card must remain
 * identifiable when it does not. Keeping this treatment outside the image
 * makes custom and starter campaigns use the same readable title surface.
 */
export const CampaignTitleOverlay: React.FC<CampaignTitleOverlayProps> = ({
  title,
  className,
  style,
}) => (
  <div
    className={cn(
      'rounded-lg border border-amber-200/25 bg-black/55 px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md',
      className,
    )}
    style={style}
  >
    <span className="block text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-200/80">
      Campaign
    </span>
    <h3 className="mt-1 truncate text-lg font-bold leading-tight text-white drop-shadow-md sm:text-xl">
      {title}
    </h3>
  </div>
);
