/**
 * Picks the place the DM is describing, so the scene art can follow it.
 *
 * The slug rule matches scripts/upload-campaign-assets.ts (slugForLookup), so a
 * location name in the DM's prose resolves to the same chunk the uploader linked.
 */

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

export function slugForLookup(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Returns the location asset named last in the text, or null when no location
 * name appears. Names match on whole words: "The Heartwood" does not match
 * inside "The Heartwood Basin" unless the basin is also named. The match that
 * ends last wins; when two names end at the same words, the longer name wins.
 */
export function findPlaceInText(text: string, locations: CampaignAsset[]): CampaignAsset | null {
  const haystack = `-${slugForLookup(text)}-`;
  let best: CampaignAsset | null = null;
  let bestEnd = -1;
  let bestLength = 0;

  for (const location of locations) {
    const slug = slugForLookup(location.name);
    if (!slug) continue;
    const index = haystack.lastIndexOf(`-${slug}-`);
    if (index === -1) continue;
    const end = index + slug.length;
    if (end > bestEnd || (end === bestEnd && slug.length > bestLength)) {
      best = location;
      bestEnd = end;
      bestLength = slug.length;
    }
  }

  return best;
}
