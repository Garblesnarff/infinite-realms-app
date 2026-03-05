/**
 * Parse asset tags from AI message content
 *
 * The AI is instructed to use [ASSET:type:key] tags when mentioning
 * entities that have associated images. This utility extracts those
 * tags and provides the clean text for display.
 *
 * Supported tag format: [ASSET:type:key]
 * Examples:
 *   [ASSET:character:the-veteran]
 *   [ASSET:npc:luna-silverhand]
 *   [ASSET:location:bone-cathedral]
 *   [ASSET:monster:abyssal-horror]
 */

export interface AssetTag {
  type: 'character' | 'npc' | 'location' | 'monster' | 'item' | 'scene' | 'entity';
  key: string;
  fullMatch: string;
}

export interface ParsedAssets {
  /** Message content with asset tags removed */
  cleanContent: string;
  /** Extracted asset references */
  assets: AssetTag[];
}

/** Regex pattern to match [ASSET:type:key] tags */
export const ASSET_TAG_PATTERN =
  /\[ASSET:(character|npc|location|monster|item|scene|entity):([a-z0-9-]+)\]/gi;

/**
 * Normalize asset tag keys that the AI may have generated with quoted or special
 * characters (e.g. [ASSET:npc:remy-"the-manager"]).
 *
 * Uses a loose capture regex so it matches ANY key (not just well-formed ones),
 * then rewrites each tag with a sanitized key so the strict ASSET_TAG_PATTERN
 * can match and strip them in the next pass.
 */
export function normalizeAssetTagKeysInContent(content: string): string {
  const loosePattern = /\[ASSET:(character|npc|location|monster|item|scene|entity):([^\]]+)\]/gi;
  return content.replace(loosePattern, (fullMatch, type, rawKey, offset, wholeString) => {
    const normalized = rawKey
      .toLowerCase()
      .replace(/[""''«»`"']/g, '') // strip quote variants
      .replace(/[^a-z0-9\s-]/g, '') // strip remaining specials
      .replace(/\s+/g, '-') // spaces → hyphens
      .replace(/-+/g, '-') // collapse duplicate hyphens
      .replace(/^-+|-+$/g, ''); // trim surrounding hyphens

    const normalizedTag = `[ASSET:${type}:${normalized}]`;

    // If the raw key was malformed (quotes, caps, or other non-standard chars), the AI
    // may have used the tag as a name placeholder. Prepend a derived display name so it
    // survives tag stripping — UNLESS the text immediately after the tag already starts
    // with that name (prevents "Remy the Manager Remy" double-name).
    const isAlreadyNormalized = /^[a-z0-9-]+$/.test(rawKey);
    if (!isAlreadyNormalized) {
      const derivedName = normalized
        .split('-')
        .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
      const firstWord = derivedName.split(' ')[0].toLowerCase();
      // Strip leading non-alpha chars (e.g. markdown bold `**`) before checking
      const afterTag = wholeString.slice(offset + fullMatch.length).replace(/^[^a-zA-Z]+/, '');
      const nameAlreadyPresent = afterTag.toLowerCase().startsWith(firstWord);
      if (!nameAlreadyPresent) {
        return `${derivedName} ${normalizedTag}`;
      }
    }

    return normalizedTag;
  });
}

/**
 * Parse asset tags from message content
 *
 * @param content - Raw message content that may contain [ASSET:...] tags
 * @returns Object with clean content and extracted assets
 */
export function parseAssetTags(content: string): ParsedAssets {
  const assets: AssetTag[] = [];

  // Normalize malformed keys (e.g. with quotes) before the strict pattern runs
  const normalizedContent = normalizeAssetTagKeysInContent(content);

  // Find all asset tags
  let match: RegExpExecArray | null;
  const pattern = new RegExp(ASSET_TAG_PATTERN.source, 'gi');

  while ((match = pattern.exec(normalizedContent)) !== null) {
    assets.push({
      type: match[1].toLowerCase() as AssetTag['type'],
      key: match[2].toLowerCase(),
      fullMatch: match[0],
    });
  }

  // Remove asset tags from content for display, collapsing any resulting double spaces
  const cleanContent = normalizedContent
    .replace(ASSET_TAG_PATTERN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  // Deduplicate assets (same entity may be mentioned multiple times)
  const uniqueAssets = assets.filter(
    (asset, index, self) =>
      index === self.findIndex((a) => a.type === asset.type && a.key === asset.key),
  );

  return {
    cleanContent,
    assets: uniqueAssets,
  };
}

/**
 * Check if content contains any asset tags
 */
export function hasAssetTags(content: string): boolean {
  return ASSET_TAG_PATTERN.test(content);
}
