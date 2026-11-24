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
 * Reads the tracked place from the message's story trackers
 * (`message.context.storyTrackers`, the session's stored clocks the server
 * attaches to the DM envelope; shape `Array<{name, value, limit}>` in
 * server-bun/src/services/dm/dm-response-schema.ts). A tracker names a
 * place when its name matches a campaign location with the same slug rule
 * — a bare place name ("The Heartwood") or a Scene-prefixed one
 * ("Scene: The Heartwood"); the slug rule matches the trailing location
 * name in either form, and the longer-name-wins tiebreak in
 * findPlaceInText picks the full name. An ordinary clock ("Torches")
 * matches no location and contributes nothing. The first tracker that
 * names a place wins — the list is the session's full stored clock list
 * in campaign clock-definition order with no recency signal, so this
 * assumes a campaign defines at most one place-named clock (the common
 * case: the #1042 audit found 14 of 18 campaigns carry one clock each);
 * with two place-named clocks the band pins to the earliest-defined one.
 * Returns null when the trackers are absent, malformed, or name no
 * campaign location.
 */
export function findPlaceInStoryTrackers(
  storyTrackers: unknown,
  locations: CampaignAsset[],
): CampaignAsset | null {
  if (!Array.isArray(storyTrackers)) return null;
  for (const entry of storyTrackers) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const place = findPlaceInText(name, locations);
    if (place) return place;
  }
  return null;
}

/**
 * Builds the candidate tag list shared by the scene band and the background
 * effect, so the two cannot drift. Explicit tags come first, then the tracked
 * place from the reply's story trackers, then the official context
 * location, then a place named in the prose. A place with no matching
 * chunk contributes nothing. The reply text is deliberately not a source
 * for the tracked place: the server strips a `[Place]` line from the
 * narration only when it sits in a whole-line run of 2+ tracker-shaped
 * groups (narration-text.ts stripWholeLineTrackerRuns), so a lone
 * `[Place]` line survives but the text is not a reliable source — the
 * tracked place survives only in the context the server attached.
 */
export function sceneCandidateTags(
  assetTags: Array<{ type: string; key: string }>,
  text: string,
  contextLocation: string | null | undefined,
  locations: CampaignAsset[],
  storyTrackers: unknown = undefined,
): Array<{ type: string; key: string }> {
  const candidates = [...assetTags];
  // The reply's story trackers carry the tracked place (#1026): a tracker
  // naming the place beats a place merely mentioned in the prose.
  const trackedPlace = findPlaceInStoryTrackers(storyTrackers, locations);
  if (trackedPlace) {
    candidates.push({ type: 'location', key: trackedPlace.key });
  }
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
