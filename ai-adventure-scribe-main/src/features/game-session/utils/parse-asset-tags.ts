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
 * Parse asset tags from message content
 *
 * @param content - Raw message content that may contain [ASSET:...] tags
 * @returns Object with clean content and extracted assets
 */
export function parseAssetTags(content: string): ParsedAssets {
  const assets: AssetTag[] = [];

  // Find all asset tags
  let match: RegExpExecArray | null;
  const pattern = new RegExp(ASSET_TAG_PATTERN.source, 'gi');

  while ((match = pattern.exec(content)) !== null) {
    assets.push({
      type: match[1].toLowerCase() as AssetTag['type'],
      key: match[2].toLowerCase(),
      fullMatch: match[0],
    });
  }

  // Remove asset tags from content for display, collapsing any resulting double spaces
  const cleanContent = content
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
