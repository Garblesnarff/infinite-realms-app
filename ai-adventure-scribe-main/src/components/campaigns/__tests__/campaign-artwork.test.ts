import { describe, expect, it } from 'vitest';

import { CAMPAIGN_ARTWORK_PLACEHOLDER, resolveCampaignArtwork } from '../campaign-artwork';

describe('resolveCampaignArtwork', () => {
  it('uses the neutral placeholder when a custom campaign has no cover', () => {
    expect(resolveCampaignArtwork(null)).toBe(CAMPAIGN_ARTWORK_PLACEHOLDER);
    expect(resolveCampaignArtwork(undefined)).toBe(CAMPAIGN_ARTWORK_PLACEHOLDER);
    expect(resolveCampaignArtwork('')).toBe(CAMPAIGN_ARTWORK_PLACEHOLDER);
  });

  it('never substitutes The Lost Temple art for a missing cover', () => {
    expect(resolveCampaignArtwork('/card-background.jpeg')).toBe(CAMPAIGN_ARTWORK_PLACEHOLDER);
    expect(resolveCampaignArtwork('https://cdn.example.com/card-background.jpeg')).toBe(
      CAMPAIGN_ARTWORK_PLACEHOLDER,
    );
  });

  it('keeps authored cover URLs', () => {
    expect(resolveCampaignArtwork('https://cdn.example.com/cogwork-dirge.png')).toBe(
      'https://cdn.example.com/cogwork-dirge.png',
    );
  });
});
