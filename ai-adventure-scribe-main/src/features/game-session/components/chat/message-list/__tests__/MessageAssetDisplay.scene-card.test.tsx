import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageAssetDisplay } from '../MessageAssetDisplay';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

// The Generate / Scene card and its "Show scene art" reveal were removed by #1236 D. Each test
// below replaces one test of the original #2256 suite, so the history of what the card did stays
// checked. Mapping: the first test became "no Generate / Scene card for untagged messages";
// the second became "no reveal step"; the third became "no card while generating or failed";
// the fourth became "no View generated scene card"; the fifth became "renders nothing without an image".

const tavern: CampaignAsset = {
  type: 'location',
  key: 'the-tavern',
  name: 'The Tavern',
  imageUrl: 'tavern.png',
};

const renderDisplay = (getAsset: (type: string, key: string) => CampaignAsset | null) =>
  render(
    <MessageAssetDisplay
      assetTags={[
        { type: 'location', key: 'the-tavern', fullMatch: '[ASSET:location:the-tavern]' },
      ]}
      getAsset={getAsset}
    />,
  );

describe('MessageAssetDisplay after the scene card was removed (#1236 D; was #2256)', () => {
  it('renders no Generate / Scene card and no Show scene art control for an untagged message', () => {
    const { container } = renderDisplay(() => null);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /generate scene image/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
  });

  it('has no reveal step: no Show scene art control and no generate card, even with a tagged asset', () => {
    renderDisplay((type, key) => (type === 'location' && key === 'the-tavern' ? tavern : null));

    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate scene image/i })).toBeNull();
    expect(screen.getByText('The Tavern')).toBeInTheDocument();
  });

  it('shows no generating or failed card here; that state belongs to the footer control in DMMessage', () => {
    renderDisplay((type, key) => (type === 'location' && key === 'the-tavern' ? tavern : null));

    expect(screen.queryByRole('button', { name: 'Generating scene image' })).toBeNull();
    expect(screen.queryByText(/generating|could not|failed/i)).toBeNull();
  });

  it('shows no View generated scene card; a scene image is the band above the text', () => {
    renderDisplay((type, key) => (type === 'location' && key === 'the-tavern' ? tavern : null));

    expect(screen.queryByRole('button', { name: 'View generated scene' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
  });

  it('renders nothing when no tagged asset has an image', () => {
    const { container } = renderDisplay(() => ({ ...tavern, imageUrl: null }));

    expect(container).toBeEmptyDOMElement();
  });
});
