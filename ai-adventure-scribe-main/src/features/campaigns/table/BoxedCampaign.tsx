import React from 'react';
import { Link } from 'react-router-dom';

import { tableImageUrl } from './image-url';
import { TableImage } from './TableImage';
import { showTargetNumbersByDefault } from '../../../../shared/show-target-numbers';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

/** Boxed-set tilt from the Campaigns board: left, straight, right. */
const TILTS = [-2.5, 0, 2.5];

const tiltFor = (index: number | undefined, slug: string): number => {
  const slot = index ?? [...slug].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return TILTS[((slot % 3) + 3) % 3];
};

export const BoxedCampaign: React.FC<{
  campaign: StarterCampaign;
  isFirst?: boolean;
  /** Position in the shelf; sets the tilt (-2.5°, 0°, +2.5°). Falls back to a stable slug hash. */
  index?: number;
}> = ({ campaign, isFirst = false, index }) => {
  const cover = tableImageUrl(campaign.coverImageUrl, 640, 800);
  const shown = showTargetNumbersByDefault(campaign.difficulty);
  const difficulty = campaign.difficulty?.trim().toLowerCase() ?? '';
  const difficultyLabel = difficulty.includes('medium')
    ? 'Medium'
    : difficulty.includes('hard')
      ? 'Hard'
      : difficulty.includes('deadly')
        ? 'Deadly'
        : difficulty.includes('easy')
          ? 'Easy'
          : 'Medium';
  const hard = difficultyLabel === 'Hard' || difficultyLabel === 'Deadly';
  const level = campaign.levelRange?.trim();
  const footer = [level ? `Level ${level}` : null, 'Ready-made heroes'].filter(Boolean).join(' · ');
  const tilt = tiltFor(index, campaign.slug);

  return (
    <article className="flex min-w-0 flex-col">
      <Link
        to={`/explore/${campaign.slug}`}
        aria-label={`Explore ${campaign.title} campaign`}
        style={{ '--tilt': `${tilt}deg` } as React.CSSProperties}
        className="flex h-full min-w-0 flex-col rounded-md [transform:rotate(var(--tilt))] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8] motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-out motion-safe:hover:[transform:translateY(-8px)_rotate(0deg)]"
      >
        <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-md bg-[#0b1020] shadow-[0_0_0_2px_#0a0f1c,0_0_0_4px_rgba(213,176,112,0.55),0_0_0_5px_#0a0f1c]">
          <div className="relative h-[236px] overflow-hidden bg-[#0e1a36]">
            <TableImage
              src={cover}
              alt={`${campaign.title} cover art`}
              width={640}
              height={800}
              loading={isFirst ? 'eager' : 'lazy'}
              className="h-full w-full object-cover"
              fallback={
                <span
                  role="img"
                  aria-label={`${campaign.title} artwork coming soon`}
                  className="flex h-full items-center justify-center text-5xl text-[#f6e3b8]"
                >
                  {campaign.title.charAt(0)}
                </span>
              }
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                background: 'linear-gradient(180deg, transparent 45%, rgba(7,11,20,0.92) 100%)',
              }}
            />
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              {campaign.genre.map((genre) => (
                <span
                  key={genre}
                  className="rounded-[5px] border border-[rgba(234,238,250,0.35)] bg-[rgba(7,11,20,0.8)] px-2 py-[3px] font-heading text-[11px] uppercase tracking-[0.08em] text-[#eaeefa]"
                >
                  {genre}
                </span>
              ))}
            </div>
            <span
              className="normal-case absolute right-3 top-3 rounded-[5px] border bg-[rgba(7,11,20,0.8)] px-2 py-[3px] font-heading text-[11px] font-bold tracking-[0.08em]"
              style={{
                borderColor: hard ? '#ef6b6b' : '#f3deb0',
                color: hard ? '#ef6b6b' : '#f3deb0',
              }}
            >
              {difficultyLabel}
            </span>
            <h3 className="absolute bottom-3 left-4 right-4 font-heading text-[26px] font-bold leading-[1.1] text-[#f3deb0] [text-shadow:0_2px_6px_#000]">
              {campaign.title}
            </h3>
          </div>
          <div
            className="flex flex-1 flex-col gap-2 p-4 text-[#2a1a0c]"
            style={{ background: 'linear-gradient(175deg, #f2e7cd 0%, #e2cfa4 100%)' }}
          >
            <p className="text-[17px] leading-[1.45]">{campaign.premise}</p>
            <p className="mt-auto text-[15px] text-[#5b4630]">{footer}</p>
            <span className="ir-brass-btn mt-1 flex min-h-11 items-center justify-center rounded px-4 font-semibold">
              Open the box
            </span>
            <p className="text-xs text-[#5b4630]">
              {difficultyLabel} campaign: target numbers (DC and AC) start{' '}
              {shown ? 'shown' : 'hidden'}. You can {shown ? 'hide' : 'show'} them in Settings →
              Table.
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
};
