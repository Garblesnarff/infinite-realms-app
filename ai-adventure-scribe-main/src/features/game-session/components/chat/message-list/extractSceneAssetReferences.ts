/**
 * Extracts [ASSET:type:key] tag references from a DM message and resolves
 * them to reference image URLs, split out of useImageGeneration.ts.
 */

import {
  ASSET_TAG_PATTERN,
  normalizeAssetTagKeysInContent,
} from '@/features/game-session/utils/parse-asset-tags';
import logger from '@/lib/logger';
import { type AssetReference } from '@/services/scene-image-generator';

export function extractSceneAssetReferences(
  messageText: string | undefined,
  baseText: string,
  getAssetImageUrl?: (type: string, key: string) => string | null,
): AssetReference[] {
  const assetUrls: AssetReference[] = [];
  if (!getAssetImageUrl) return assetUrls;

  // Parse [ASSET:type:key] tags from message text using shared pattern.
  // Normalize first so malformed keys (e.g. with quotes) are matched.
  const tagPattern = new RegExp(ASSET_TAG_PATTERN.source, 'gi');
  let match;
  const seen = new Set<string>();
  const fullText = normalizeAssetTagKeysInContent(messageText || baseText);
  while ((match = tagPattern.exec(fullText)) !== null) {
    const [, type, key] = match;
    const lookupKey = `${type}:${key}`;
    if (!seen.has(lookupKey)) {
      seen.add(lookupKey);
      const url = getAssetImageUrl(type, key);
      if (url) {
        assetUrls.push({
          url,
          type: type as AssetReference['type'],
          name: key,
        });
      }
    }
  }
  if (assetUrls.length > 0) {
    logger.info('[useImageGeneration] Found asset references for scene', {
      count: assetUrls.length,
      types: assetUrls.map((a) => a.type),
    });
  }

  return assetUrls;
}
