import React from 'react';
import { Link } from 'react-router-dom';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { tableImageUrl } from '@/features/campaigns/table/image-url';
import { TableImage } from '@/features/campaigns/table/TableImage';
import { formatStarterLevelRange } from '@/utils/campaign/starter-level-range';

/**
 * Public Explore card, drawn from the PublicExplore board (docs/design/canvas/PublicExplore.dc.html):
 * one navy card with a gold ring, cover art under a navy fade, genre and difficulty pills, the title,
 * the hook, a meta line, and a "Begin your journey" call to action. Only /explore uses it. The boxed
 * parchment card (BoxedCampaign, #1484) is a separate component and is not changed here.
 */
export const PUBLIC_EXPLORE_COLOURS = {
  card: '#0c1220',
  navy: '#070b14',
  gold: '#d5b070',
  goldText: '#f3deb0',
  hook: '#d4dbef',
  meta: '#aab3cc',
  tag: '#eaeefa',
  hard: '#ef8a8a',
  medium: '#f3deb0',
} as const;

/** Board difficulty label, copied from the campaign's difficulty text. Defaults to Medium. */
export const difficultyLabelFor = (difficulty: string | null | undefined): string => {
  const value = difficulty?.trim().toLowerCase() ?? '';
  if (value.includes('medium')) return 'Medium';
  if (value.includes('hard')) return 'Hard';
  if (value.includes('deadly')) return 'Deadly';
  if (value.includes('easy')) return 'Easy';
  return 'Medium';
};

/**
 * Meta line: "Level 1 · 8–10 sessions". A part the campaign does not have is left out, so a
 * missing level or session count never shows a placeholder.
 */
export const metaLineFor = (
  campaign: Pick<StarterCampaign, 'levelRange' | 'estimatedSessions'>,
) => {
  // The level is the played range, as the detail page shows it (a glued span such as 7-10-11 is 7-11).
  const level = formatStarterLevelRange(campaign.levelRange);
  const sessions = campaign.estimatedSessions?.trim().replace(/-/g, '–');
  const sessionsLabel = sessions === '1' ? '1 session' : sessions ? `${sessions} sessions` : null;
  return [level ? `Level ${level}` : null, sessionsLabel].filter(Boolean).join(' · ');
};

/** Genre pills shown on the card. The rest are counted ("+1") so the tags stay on one row. */
export const VISIBLE_GENRE_PILLS = 2;

export const genrePillsFor = (genres: string[]): { shown: string[]; hidden: number } => ({
  shown: genres.slice(0, VISIBLE_GENRE_PILLS),
  hidden: Math.max(0, genres.length - VISIBLE_GENRE_PILLS),
});

export const PublicExploreCard: React.FC<{
  campaign: StarterCampaign;
  isFirst?: boolean;
}> = ({ campaign, isFirst = false }) => {
  const cover = tableImageUrl(campaign.coverImageUrl, 640, 800);
  const difficultyLabel = difficultyLabelFor(campaign.difficulty);
  const hard = difficultyLabel === 'Hard' || difficultyLabel === 'Deadly';
  const difficultyColour = hard ? PUBLIC_EXPLORE_COLOURS.hard : PUBLIC_EXPLORE_COLOURS.medium;
  const meta = metaLineFor(campaign);
  const genres = genrePillsFor(campaign.genre);

  return (
    <article className="flex min-w-0 flex-col">
      <Link
        to={`/explore/${campaign.slug}`}
        aria-label={`${campaign.title}, ${difficultyLabel} difficulty. Begin your journey`}
        className="group relative block aspect-[8/9] w-full min-w-0 overflow-hidden rounded-2xl bg-[#0c1220] text-[#eaeefa] no-underline shadow-[0_0_0_1px_rgba(213,176,112,0.28),0_14px_30px_rgba(0,0,0,0.45)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[#f3deb0] motion-safe:transition-[transform,box-shadow] motion-safe:duration-300 motion-safe:ease-out motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-[0_0_0_2px_#d5b070,0_22px_40px_rgba(0,0,0,0.55)]"
      >
        <TableImage
          src={cover}
          alt=""
          width={640}
          height={800}
          loading={isFirst ? 'eager' : 'lazy'}
          className="absolute inset-0 h-full w-full object-cover object-center"
          fallback={
            <span
              role="img"
              aria-label={`${campaign.title} artwork coming soon`}
              className="absolute inset-x-0 top-14 text-center font-heading text-5xl text-[#f3deb0]"
            >
              {campaign.title.charAt(0)}
            </span>
          }
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(7,11,20,0.05) 0%, rgba(7,11,20,0.5) 42%, #070b14 100%)',
          }}
        />

        <div className="absolute left-4 top-4 flex max-w-[calc(100%-8rem)] flex-nowrap items-center gap-1.5 overflow-hidden">
          {genres.shown.map((genre) => (
            <span
              key={genre}
              className="shrink-0 rounded-full border border-[rgba(234,238,250,0.4)] bg-[#070b14] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em] text-[#eaeefa]"
            >
              {genre}
            </span>
          ))}
          {genres.hidden > 0 && (
            <span className="shrink-0 rounded-full border border-[rgba(234,238,250,0.4)] bg-[#070b14] px-2.5 py-1 text-xs font-bold tracking-[0.06em] text-[#eaeefa]">
              +{genres.hidden}
            </span>
          )}
        </div>
        <span
          className="absolute right-4 top-4 rounded-full bg-[#070b14] px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em]"
          style={{
            border: `1px solid ${difficultyColour}`,
            color: difficultyColour,
          }}
        >
          {difficultyLabel}
        </span>

        <div className="absolute bottom-5 left-[22px] right-[22px] flex flex-col gap-2">
          <h2 className="font-heading text-[28px] font-bold leading-[1.12] text-[#f3deb0] [text-shadow:0_2px_8px_#000]">
            {campaign.title}
          </h2>
          <p className="m-0 h-[68px] overflow-hidden text-[15px] leading-normal text-[#d4dbef] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3]">
            {campaign.premise}
          </p>
          <p className="m-0 flex h-[22px] items-center text-sm text-[#aab3cc]">{meta}</p>
          <span className="inline-flex min-h-7 items-center gap-1.5 text-base font-bold text-[#d5b070]">
            Begin your journey
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 12h14M13 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </Link>
    </article>
  );
};

export default PublicExploreCard;
