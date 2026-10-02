import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { MessageAssetDisplay } from '../MessageAssetDisplay';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

import { parseAssetTags } from '@/features/game-session/utils/parse-asset-tags';

// Same shape the hook builds for a campaign_chunks row with chunk_type 'faction'.
const FACTION: CampaignAsset = {
  type: 'faction',
  key: 'eternal-feast',
  name: 'Eternal Feast',
  imageUrl: 'https://example.test/eternal-feast.webp',
};

describe('MessageAssetDisplay faction card (#2198)', () => {
  it('renders a faction image from a [ASSET:faction:key] tag in a DM message', () => {
    const { assets } = parseAssetTags('[ASSET:faction:eternal-feast] The Eternal Feast arrives.');
    expect(assets).toHaveLength(1);
    expect(assets[0].type).toBe('faction');

    render(
      <MessageAssetDisplay
        assetTags={assets}
        getAsset={(type, key) => (type === 'faction' && key === 'eternal-feast' ? FACTION : null)}
      />,
    );

    const card = screen.getByRole('button', { name: 'View Eternal Feast' });
    expect(card).toHaveTextContent('faction');
    expect(screen.getByRole('img', { name: 'Eternal Feast' })).toHaveAttribute(
      'src',
      FACTION.imageUrl,
    );

    fireEvent.click(card);
    expect(screen.getByText('Eternal Feast preview')).toBeInTheDocument();
  });
});
