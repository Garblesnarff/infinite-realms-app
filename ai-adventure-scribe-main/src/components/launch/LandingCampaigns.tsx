/**
 * Landing "Start a story tonight" row (Table 12, Landing board).
 *
 * Three real starter campaigns, one card each: a link to the campaign page, cover art,
 * difficulty chip, title, genre and the "Begin your journey" call to action.
 */

import React from 'react';
import { Link } from 'react-router-dom';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';

const LANDING_CAMPAIGN_COUNT = 3;

function formatDifficulty(difficulty: string): string {
  return difficulty
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function difficultyColor(difficulty: string): string {
  return difficulty === 'hard' || difficulty === 'deadly' ? '#ef8a8a' : '#f3deb0';
}

const LandingCampaignCard: React.FC<{ campaign: StarterCampaign }> = ({ campaign }) => {
  const [artFailed, setArtFailed] = React.useState(false);
  const difficulty = formatDifficulty(campaign.difficulty);
  const color = difficultyColor(campaign.difficulty);
  const showArt = Boolean(campaign.coverImageUrl) && !artFailed;

  return (
    <Link
      to={`/explore/${campaign.slug}`}
      aria-label={`${campaign.title}, ${difficulty} difficulty`}
      data-track-cta="landing_campaign"
      className="group relative mx-auto block aspect-square w-full max-w-[400px] overflow-hidden rounded-2xl bg-[#0c1220] text-[#eaeefa] shadow-[0_0_0_1px_rgba(213,176,112,0.28),0_14px_30px_rgba(0,0,0,0.45)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_0_0_2px_#d5b070,0_22px_40px_rgba(0,0,0,0.55)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f3deb0] motion-reduce:transition-none motion-reduce:hover:transform-none"
    >
      {showArt ? (
        <img
          src={campaign.coverImageUrl ?? undefined}
          alt=""
          loading="lazy"
          onError={() => setArtFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center font-heading text-6xl text-[#d5b070]/60"
        >
          {campaign.title.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-[#070b14]/5 via-[#070b14]/50 to-[#070b14]" />
      <span
        className="absolute right-4 top-4 rounded-full border bg-[#070b14] px-2.5 py-1 text-xs font-bold tracking-[0.06em]"
        style={{ borderColor: color, color }}
      >
        {difficulty}
      </span>
      <div className="absolute bottom-5 left-[22px] right-[22px] flex flex-col gap-2">
        <div className="font-heading text-[26px] font-bold leading-[1.12] text-[#f3deb0] [text-shadow:0_2px_8px_#000]">
          {campaign.title}
        </div>
        {campaign.genre.length > 0 && (
          <div className="text-sm text-[#aab3cc]">{campaign.genre.slice(0, 2).join(' · ')}</div>
        )}
        <span className="inline-flex min-h-7 items-center gap-1.5 text-base font-bold text-[#d5b070]">
          Begin your journey <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
};

export const LandingCampaigns: React.FC = () => {
  const { featuredCampaigns, campaigns, isLoading } = useStarterCampaigns();
  const list = (featuredCampaigns.length > 0 ? featuredCampaigns : campaigns).slice(
    0,
    LANDING_CAMPAIGN_COUNT,
  );

  // Loaded and empty: nothing will arrive later, so there is nothing to reserve for.
  if (!isLoading && list.length === 0) return null;

  return (
    <section
      aria-labelledby="landing-campaigns"
      aria-busy={isLoading || undefined}
      className="mx-auto max-w-[1280px] px-4 py-16 sm:py-20"
    >
      <div className="text-center">
        <h2
          id="landing-campaigns"
          className="font-heading text-3xl font-bold text-[#f3deb0] sm:text-[44px]"
        >
          Start a story tonight
        </h2>
        <p className="mx-auto mt-3 max-w-[620px] text-lg leading-relaxed text-[#aab3cc]">
          Every campaign has ready-made heroes. No setup.
        </p>
      </div>
      {isLoading ? (
        // Reserved-height skeleton (#1432 item 5): the same grid and the same
        // aspect-square card boxes as the loaded row, so the page does not jump
        // when the campaigns arrive.
        <ul
          data-testid="landing-campaigns-skeleton"
          aria-hidden="true"
          className="mt-11 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <div className="mx-auto aspect-square w-full max-w-[400px] animate-pulse rounded-2xl bg-[#0c1220] shadow-[0_0_0_1px_rgba(213,176,112,0.28),0_14px_30px_rgba(0,0,0,0.45)] motion-reduce:animate-none" />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-11 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-3">
          {list.map((campaign) => (
            <li key={campaign.id}>
              <LandingCampaignCard campaign={campaign} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8 text-center">
        <Link
          to="/explore"
          className="inline-flex min-h-11 items-center text-[17px] font-bold text-[#d5b070] hover:text-[#f3deb0]"
        >
          See all adventures →
        </Link>
      </div>
    </section>
  );
};

export default LandingCampaigns;
