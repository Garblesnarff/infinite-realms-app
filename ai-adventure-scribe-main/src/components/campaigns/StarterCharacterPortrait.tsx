import React, { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

export interface StarterCharacterPortraitProps {
  name: string;
  portraitUrl: string | null;
  fallback: React.ReactNode;
  className?: string;
  imageClassName?: string;
}

/**
 * Render a starter portrait without leaving a broken-image icon when artwork
 * is absent from the starter-campaign data or the asset host fails to serve it.
 *
 * Mirrors the honest-placeholder convention used for campaign cover art
 * (see `campaign-artwork.ts` / `StarterCampaignCard.tsx`): a neutral fallback
 * plus a short, honest label, distinguishing "not linked yet" (no
 * `portraitUrl`) from "failed to load" (an `onError` from a real URL) rather
 * than collapsing both into one generic message.
 */
export const StarterCharacterPortrait: React.FC<StarterCharacterPortraitProps> = ({
  name,
  portraitUrl,
  fallback,
  className,
  imageClassName,
}) => {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [portraitUrl]);

  if (!portraitUrl || hasError) {
    const label = hasError ? `${name} portrait unavailable` : `${name} portrait coming soon`;
    const srText = hasError ? 'Portrait unavailable' : 'Portrait coming soon';

    return (
      <div
        role="img"
        aria-label={label}
        className={cn('flex items-center justify-center', className)}
      >
        {fallback}
        <span className="sr-only">{srText}</span>
      </div>
    );
  }

  return (
    <img
      src={portraitUrl}
      alt={name}
      className={cn('object-cover', className, imageClassName)}
      onError={() => setHasError(true)}
    />
  );
};
