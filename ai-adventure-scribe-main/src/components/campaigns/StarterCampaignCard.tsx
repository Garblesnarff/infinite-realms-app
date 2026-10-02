/**
 * Starter Campaign Card Component
 *
 * Displays a starter campaign as one link: cover art (with a gradient and
 * letter fallback), genre and difficulty chips, hook, meta line and call to action.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { Badge } from '@/components/ui/badge';
import { formatStarterLevelRange } from '@/utils/campaign/starter-level-range';

interface StarterCampaignCardProps {
  campaign: StarterCampaign;
  /** First card in the grid: load its art eagerly (it is the likely LCP image). */
  isFirst?: boolean;
}

/**
 * Get difficulty chip styling: text color plus a matching 45% border.
 */
function getDifficultyStyle(difficulty: string): string {
  switch (difficulty) {
    case 'easy':
    case 'low-medium':
      return 'text-ir-hp-good border-[color:color-mix(in_srgb,var(--ir-hp-good)_45%,transparent)]';
    case 'medium':
    case 'medium-hard':
      return 'text-infinite-gold border-infinite-gold/45';
    case 'hard':
    case 'deadly':
      return 'text-ir-hp-bad border-[color:color-mix(in_srgb,var(--ir-hp-bad)_45%,transparent)]';
    default:
      return 'text-foreground border-white/10';
  }
}

/**
 * Format difficulty for display
 */
function formatDifficulty(difficulty: string): string {
  return difficulty
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const StarterCampaignCard: React.FC<StarterCampaignCardProps> = ({
  campaign,
  isFirst = false,
}) => {
  const [imageState, setImageState] = React.useState<'loading' | 'loaded' | 'failed'>(
    campaign.coverImageUrl ? 'loading' : 'failed',
  );

  React.useEffect(() => {
    setImageState(campaign.coverImageUrl ? 'loading' : 'failed');
  }, [campaign.coverImageUrl]);

  const artworkUnavailable = imageState === 'failed';
  const level = formatStarterLevelRange(campaign.levelRange)?.split('-')[0];
  const initial = campaign.title.trim().charAt(0).toUpperCase();

  return (
    <Link
      to={`/explore/${campaign.slug}`}
      className="grid h-full grid-rows-[auto_1fr] rounded-[13px] border border-white/10 bg-[color:var(--infinite-surface)] overflow-hidden transition-[border-color,box-shadow] duration-200 hover:border-infinite-gold/55 hover:shadow-glow-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-infinite-gold"
      aria-label={`Explore ${campaign.title} campaign`}
    >
      {/* Art: gradient + first letter shows while the image loads or if it fails */}
      <div
        role={artworkUnavailable ? 'img' : undefined}
        aria-label={artworkUnavailable ? `${campaign.title} artwork coming soon` : undefined}
        className="relative aspect-video overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,var(--infinite-surface),var(--infinite-dark)_60%)]"
      >
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-heading text-5xl text-infinite-gold/60"
        >
          {initial}
        </span>
        {campaign.coverImageUrl && !artworkUnavailable && (
          <img
            src={campaign.coverImageUrl}
            alt={`${campaign.title} cover art`}
            width={640}
            height={360}
            className={`relative h-full w-full object-cover transition-opacity duration-300 ${imageState === 'loaded' ? 'opacity-100' : 'opacity-0'}`}
            loading={isFirst ? 'eager' : 'lazy'}
            {...(isFirst ? { fetchpriority: 'high' } : {})}
            onLoad={() => setImageState('loaded')}
            onError={() => setImageState('failed')}
          />
        )}
        {/* Genre chips - top left, one line, never under the difficulty chip */}
        <div className="absolute left-3 top-3 flex max-w-[calc(100%-96px)] gap-2 overflow-hidden">
          {campaign.genre.slice(0, 2).map((g) => (
            <Badge
              key={g}
              variant="outline"
              className="whitespace-nowrap border-white/10 bg-infinite-dark/90 text-[11px] font-normal capitalize text-foreground backdrop-blur-sm"
            >
              {g}
            </Badge>
          ))}
        </div>

        {/* Difficulty chip - top right */}
        <div className="absolute right-3 top-3">
          <Badge
            variant="outline"
            className={`bg-infinite-dark/90 text-[11px] font-semibold backdrop-blur-sm ${getDifficultyStyle(campaign.difficulty)}`}
          >
            {formatDifficulty(campaign.difficulty)}
          </Badge>
        </div>
      </div>

      {/* Body */}
      <div className="grid content-start gap-2 p-4">
        <h3 className="font-heading text-[19px] font-bold leading-tight">{campaign.title}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2">{campaign.premise}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {level && <strong className="font-semibold text-foreground">Level {level}</strong>}
          {level && campaign.estimatedSessions && ' · '}
          {campaign.estimatedSessions && (
            <>
              <strong className="font-semibold text-foreground">
                {campaign.estimatedSessions}
              </strong>{' '}
              sessions
            </>
          )}
        </p>
        <span className="text-sm font-semibold text-infinite-gold">
          See the heroes <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
};

export default StarterCampaignCard;
