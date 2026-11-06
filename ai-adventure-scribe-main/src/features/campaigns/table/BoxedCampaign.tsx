import React from 'react';
import { Link } from 'react-router-dom';

import { tableImageUrl } from './image-url';
import { TableImage } from './TableImage';
import { showTargetNumbersByDefault } from '../../../../shared/show-target-numbers';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';

export const BoxedCampaign: React.FC<{ campaign: StarterCampaign; isFirst?: boolean }> = ({
  campaign,
  isFirst = false,
}) => {
  const cover = tableImageUrl(campaign.coverImageUrl, 640, 800);
  const shown = showTargetNumbersByDefault(campaign.difficulty);
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[color:var(--infinite-surface)] [body.ir-table-look_&]:border-[#a9823f] [body.ir-table-look_&]:shadow-xl">
      <Link
        to={`/explore/${campaign.slug}`}
        aria-label={`Explore ${campaign.title} campaign`}
        className="flex h-full min-w-0 flex-col focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f6e3b8]"
      >
        <div className="relative aspect-video overflow-hidden bg-[#0e1a36] [body.ir-table-look_&]:aspect-[4/5]">
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
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="text-xs uppercase tracking-wider text-[#f6e3b8]">
            {campaign.genre.join(' · ')} · {campaign.difficulty}
          </p>
          <h3 className="font-heading text-xl font-bold">{campaign.title}</h3>
          <p className="text-sm text-muted-foreground">{campaign.premise}</p>
          <span className="ir-brass-btn mt-auto flex min-h-11 items-center justify-center rounded px-4 font-semibold">
            Open the box
          </span>
          <p className="text-xs text-muted-foreground">
            {campaign.difficulty || 'Medium'} campaign: target numbers (DC and AC) start{' '}
            {shown ? 'shown' : 'hidden'}. You can change them in Settings → Table.
          </p>
        </div>
      </Link>
    </article>
  );
};
