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
 * Reads the tracked place from the reply's `[Place]` state line, e.g.
 * `[Place: The Heartwood]` or `[Place] The Heartwood`. The state line is the
 * session's tracked place, so it beats a place merely mentioned in the prose.
 * The last state line in the reply wins; the name resolves with the same
 * slug rule as the uploader. A bracketed name without the `Place` keyword
 * is not a state line — prose asides are indistinguishable from one, and
 * findPlaceInText already matches those in the prose path.
 */
const STATE_LINE_PLACE_COLON = /^[ \t]*\[Place[ \t]*:[ \t]*([^\]\n]+)\]/gim;
const STATE_LINE_PLACE_BARE = /^[ \t]*\[Place\][ \t]*([^\n]+?)[ \t]*$/gim;

export function findPlaceInStateLine(
  text: string,
  locations: CampaignAsset[],
): CampaignAsset | null {
  let lastName: string | null = null;
  let lastIndex = -1;
  for (const pattern of [STATE_LINE_PLACE_COLON, STATE_LINE_PLACE_BARE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      // An empty capture names no place and must not erase an earlier valid
      // state line.
      const name = match[1].trim();
      if (name && match.index >= lastIndex) {
        lastIndex = match.index;
        lastName = name;
      }
    }
  }
  if (!lastName) return null;
  return findPlaceInText(lastName, locations);
}

/**
 * Builds the candidate tag list shared by the scene band and the background
 * effect, so the two cannot drift. Explicit tags come first, then the tracked
 * place from the reply's `[Place]` state line, then the official context
 * location, then a place named in the prose. A place with no matching
 * chunk contributes nothing.
 */
export function sceneCandidateTags(
  assetTags: Array<{ type: string; key: string }>,
  text: string,
  contextLocation: string | null | undefined,
  locations: CampaignAsset[],
  replyText: string = text,
): Array<{ type: string; key: string }> {
  const candidates = [...assetTags];
  // The reply's [Place] state line is the tracked place (#1026): it beats a
  // place merely mentioned in the prose. It is read from the full reply text,
  // not the display text — the display pipeline may separate it from the
  // prose (a state line after the options is cut from displayContent by
  // parseMessageOptions), so the prose lookup alone would miss it.
  const trackedPlace = findPlaceInStateLine(replyText, locations);
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
