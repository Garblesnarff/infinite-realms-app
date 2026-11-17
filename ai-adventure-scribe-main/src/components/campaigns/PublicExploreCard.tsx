/**
 * Public Explore card (#1610): one navy card per starter campaign, as on the
 * PublicExplore board (docs/design/canvas/PublicExplore.dc.html). Used only by
 * the public /explore page. The boxed parchment card (features/campaigns/table)
 * is not used here.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { tableImageUrl } from '@/features/campaigns/table/image-url';
import { TableImage } from '@/features/campaigns/table/TableImage';
import { formatStarterLevelRange } from '@/utils/campaign/starter-level-range';

interface PublicExploreCardProps {
  campaign: StarterCampaign;
  /** First card in the grid: load its art eagerly (likely LCP image). */
  isFirst?: boolean;
}

/** Board colours: hard reads in #ef8a8a, every other level in gold #f3deb0. */
const difficultyColour = (difficulty: string): string =>
  difficulty === 'hard' || difficulty === 'deadly' ? '#ef8a8a' : '#f3deb0';

const formatDifficulty = (difficulty: string): string =>
  difficulty
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export const PublicExploreCard: React.FC<PublicExploreCardProps> = ({
  campaign,
  isFirst = false,
}) => {
  const cover = tableImageUrl(campaign.coverImageUrl, 800, 900);
  const difficultyLabel = formatDifficulty(campaign.difficulty || 'medium');
  const level = formatStarterLevelRange(campaign.levelRange);
  const meta = [
    level ? `Level ${level}` : null,
    campaign.estimatedSessions ? `${campaign.estimatedSessions} sessions` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link
      to={`/explore/${campaign.slug}`}
      className="group relative block aspect-[8/9] w-full min-w-0 overflow-hidden rounded-2xl bg-[#0c1220] text-[#eaeefa] no-underline shadow-[0_0_0_1px_rgba(213,176,112,0.28),0_14px_30px_rgba(0,0,0,0.45)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_0_0_2px_#d5b070,0_22px_40px_rgba(0,0,0,0.55)] focus-visible:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#f3deb0] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <TableImage
        src={cover}
        alt=""
        width={800}
        height={900}
        loading={isFirst ? 'eager' : 'lazy'}
        className="absolute inset-0 h-full w-full object-cover"
        fallback={<span aria-hidden="true" className="absolute inset-0 bg-[#0c1220]" />}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(7,11,20,0.05) 0%, rgba(7,11,20,0.5) 42%, #070b14 100%)',
        }}
      />

      {/* Genre tags, top left */}
      <div className="absolute left-4 top-4 flex max-w-[calc(100%-7rem)] gap-1.5 overflow-hidden whitespace-nowrap">
        {campaign.genre.slice(0, 2).map((genre) => (
          <span
            key={genre}
            className="rounded-full border border-[rgba(234,238,250,0.4)] bg-[#070b14] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em] text-[#eaeefa]"
          >
            {genre}
          </span>
        ))}
      </div>

      {/* Difficulty, top right */}
      <span
        className="absolute right-4 top-4 rounded-full bg-[#070b14] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em]"
        style={{
          border: `1px solid ${difficultyColour(campaign.difficulty)}`,
          color: difficultyColour(campaign.difficulty),
        }}
      >
        {difficultyLabel}
      </span>

      {/* Title, hook, meta, call to action */}
      <div className="absolute inset-x-[22px] bottom-5 flex flex-col gap-2">
        <h2 className="font-heading text-[28px] font-bold leading-[1.12] text-[#f3deb0] [text-shadow:0_2px_8px_#000]">
          {campaign.title}
        </h2>
        <p className="line-clamp-3 h-[68px] text-[15px] leading-[1.5] text-[#d4dbef]">
          {campaign.premise}
        </p>
        <p className="flex h-[22px] items-center text-sm text-[#aab3cc]">{meta}</p>
        <span className="inline-flex min-h-11 items-center gap-1.5 text-base font-bold text-[#d5b070]">
          Begin your journey
          <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
};

export default PublicExploreCard;
