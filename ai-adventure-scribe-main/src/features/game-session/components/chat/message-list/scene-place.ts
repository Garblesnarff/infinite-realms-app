/**
 * Picks the place the DM is describing, so the scene art can follow it.
 *
 * The slug rule matches scripts/upload-campaign-assets.ts (slugForLookup), so a
 * location name in the DM's prose resolves to the same chunk the uploader linked.
 */

import { slugForLookup } from '../../../../../../shared/slug-for-lookup';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

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

/**
 * Builds the candidate tag list shared by the scene band and the background
 * effect, so the two cannot drift. Explicit tags come first, then the official context location, then a place named
 * in the prose. A place with no matching
 * chunk contributes nothing.
 */
export function sceneCandidateTags(
  assetTags: Array<{ type: string; key: string }>,
  text: string,
  contextLocation: string | null | undefined,
  locations: CampaignAsset[],
): Array<{ type: string; key: string }> {
  const candidates = [...assetTags];
  // Official current location beats a place only mentioned in the prose, so the
  // band follows the session payload's location when one is set.
  if (contextLocation) {
    const placeInContext = findPlaceInText(contextLocation, locations);
    if (placeInContext) {
      candidates.push({ type: 'location', key: placeInContext.key });
    }
  }
  const placeInText = findPlaceInText(text, locations);
  if (placeInText) {
    candidates.push({ type: 'location', key: placeInText.key });
  }
  return candidates;
}
