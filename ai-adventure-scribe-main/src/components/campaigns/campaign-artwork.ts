/** The honest storefront fallback for campaigns that do not have authored art yet. */
export const CAMPAIGN_ARTWORK_PLACEHOLDER = '/card-placeholder.svg';

/** Retired generic fallback that is actually "The Lost Temple" art. Never reuse it. */
export const RETIRED_CAMPAIGN_ARTWORK = '/card-background.jpeg';

export function isRetiredCampaignArtwork(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes('card-background.jpeg');
}

/** Custom campaigns with no cover get the neutral placeholder, never another campaign's art. */
export function resolveCampaignArtwork(url: string | null | undefined): string {
  if (!url || isRetiredCampaignArtwork(url)) {
    return CAMPAIGN_ARTWORK_PLACEHOLDER;
  }
  return url;
}
