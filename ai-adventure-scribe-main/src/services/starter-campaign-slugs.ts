/**
 * Canonical starter campaign identifiers used when a session only provides a display name.
 * These values must match both starter_campaigns.id and starter_campaigns.slug.
 */
export const STARTER_CAMPAIGN_NAME_TO_SLUG = {
  'the eternal feast': 'the-eternal-feast',
  'eternal feast': 'the-eternal-feast',
  'abyssal descent': 'abyssal-descent',
  'academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
  'the academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
} as const;

export function inferStarterCampaignSlug(campaignName: unknown): string | undefined {
  if (typeof campaignName !== 'string') return undefined;
  const normalizedName = campaignName.trim().toLowerCase().replace(/\s+/g, ' ');
  return STARTER_CAMPAIGN_NAME_TO_SLUG[
    normalizedName as keyof typeof STARTER_CAMPAIGN_NAME_TO_SLUG
  ];
}
