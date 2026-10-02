import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { generateAssetKey } from '@/utils/asset-key';
import {
  deriveAssetDisplayName,
  isAssetNamePresentAroundTag,
  normalizeAssetTagsInContent,
} from '@/utils/normalize-asset-tags';

// Asset type definition for post-processing
export interface AssetInfo {
  type: string;
  key: string;
  name: string;
}

/**
 * Prepared asset with pre-compiled regex pattern for performance
 */
interface PreparedAsset extends AssetInfo {
  pattern: RegExp;
}

// Module-level cache for assets to avoid re-fetching
let cachedAssets: { campaignId: string; assets: AssetInfo[] } | null = null;

// ⚡ Bolt: Cache for prepared assets (sorted and with compiled regexes)
// to avoid O(N log N) sorting and O(N) regex compilation on every AI response.
let preparedAssetsCache: {
  originalAssets: AssetInfo[];
  prepared: PreparedAsset[];
} | null = null;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ASSET_TAG_PATTERN = /\[ASSET:[^\]]+\]/gi;
const ASSET_TAG_KEY_PATTERN = /^\[ASSET:[^:\]]+:([^\]]+)\]$/i;

/**
 * Drop asset tags that do not have their derived entity name next to them.
 * Normalize first so repairable bare tags are retained rather than dropped.
 */
function guardAssetTags(text: string): string {
  const normalizedText = normalizeAssetTagsInContent(text);

  return normalizedText.replace(ASSET_TAG_PATTERN, (tag, offset, wholeText) => {
    const keyMatch = tag.match(ASSET_TAG_KEY_PATTERN);
    const derivedName = keyMatch ? deriveAssetDisplayName(generateAssetKey(keyMatch[1])) : '';

    if (isAssetNamePresentAroundTag(wholeText, offset, tag.length, derivedName)) return tag;

    logger.warn('[Asset Post-Processing] Dropped asset tag without visible entity name', { tag });
    return '';
  });
}

/**
 * Internal helper to prepare assets for processing (sorting and regex compilation)
 */
function getPreparedAssets(assets: AssetInfo[]): PreparedAsset[] {
  // Return cached version if it's the exact same array reference
  if (preparedAssetsCache && preparedAssetsCache.originalAssets === assets) {
    return preparedAssetsCache.prepared;
  }

  // Sort assets by name length (longest first) to avoid partial matches
  // e.g. "Lord Diabolo" matches before "Lord"
  const sorted = [...assets].sort((a, b) => b.name.length - a.name.length);

  const prepared = sorted.map((asset) => ({
    ...asset,
    pattern: new RegExp(`\\b${escapeRegex(asset.name)}\\b`, 'i'),
  }));

  preparedAssetsCache = {
    originalAssets: assets,
    prepared,
  };

  return prepared;
}

/**
 * Post-process AI response to automatically insert asset tags
 * Scans for entity names and inserts [ASSET:type:key] before them
 *
 * IMPORTANT: Only matches FULL asset names to avoid false positives.
 * e.g., "The Unwashed Dish" matches, but "dish" alone does NOT.
 */
export function insertAssetTags(text: string, assets: AssetInfo[]): string {
  let result = text;

  if (!assets || assets.length === 0) return guardAssetTags(result);

  // ⚡ Bolt: Use prepared assets to skip redundant sorting and regex compilation.
  const preparedAssets = getPreparedAssets(assets);

  for (const asset of preparedAssets) {
    // Skip if tag already exists for this asset
    const existingTag = `[ASSET:${asset.type}:${asset.key}]`;
    if (result.includes(existingTag)) continue;

    // Match FULL name only (case-insensitive, word boundary) using pre-compiled pattern
    const match = result.match(asset.pattern);

    if (match && match.index !== undefined) {
      // For single-word asset names, only auto-insert when the matched text starts with a
      // capital letter (proper-noun context). This prevents matching common English words
      // used as nouns in prose (e.g. "whisper" in "barely above a whisper").
      const isSingleWord = !asset.name.includes(' ');
      if (isSingleWord) {
        const matchedChar = result[match.index];
        if (matchedChar === matchedChar.toLowerCase()) continue;
      }

      // Check if there's already an asset tag right before this match
      const beforeMatch = result.slice(Math.max(0, match.index - 50), match.index);
      if (beforeMatch.includes('[ASSET:')) continue;

      // Walk back past leading markdown markers so the tag lands outside any emphasis span.
      // Handles "*Name", "**Name", "* Name", "** Name" (space between marker and name).
      let insertIndex = match.index;
      const before = result.slice(0, insertIndex);
      const trailingEmphasis = before.match(/\*+\s*$/);
      if (trailingEmphasis) {
        insertIndex -= trailingEmphasis[0].length;
      }

      const tag = `[ASSET:${asset.type}:${asset.key}] `;
      result = result.slice(0, insertIndex) + tag + result.slice(insertIndex);
    }
  }

  return guardAssetTags(result);
}

/**
 * Apply asset tag post-processing to response text
 * Uses cached assets from fetchCampaignAssetsForPrompt
 */
export function applyAssetPostProcessing<T extends { text: string }>(response: T): T {
  if (!cachedAssets || !cachedAssets.assets.length) {
    const processedText = guardAssetTags(response.text);
    if (processedText === response.text) return response;

    return {
      ...response,
      text: processedText,
    };
  }
  const processedText = insertAssetTags(response.text, cachedAssets.assets);
  if (processedText !== response.text) {
    logger.info(
      `[Asset Post-Processing] Inserted asset tags for ${cachedAssets.assets.length} available assets`,
    );
  }
  return {
    ...response,
    text: processedText,
  };
}

/**
 * Fetch campaign assets for AI prompt injection
 * Returns a formatted string listing available visual assets
 */
export async function fetchCampaignAssetsForPrompt(starterCampaignId: string): Promise<string> {
  const assets: AssetInfo[] = [];

  try {
    // ⚡ Bolt: Parallelize fetching of character templates and campaign chunks
    // to reduce total latency in the AI prompt generation pipeline.
    const [charactersResult, chunksResult] = await Promise.all([
      userDataApi.listStarterCharacterTemplates(starterCampaignId),
      supabase
        .from('campaign_chunks')
        .select('entity_name, chunk_type, metadata')
        .eq('campaign_id', starterCampaignId)
        .not('entity_name', 'is', null)
        .not('metadata->image_url', 'is', null),
    ]);

    const characters = charactersResult;
    const chunks = chunksResult.data;

    if (characters) {
      for (const char of characters) {
        if (char.portrait_url) {
          assets.push({
            type: 'character',
            key: char.template_key || generateAssetKey(char.name),
            name: char.name,
          });
        }
      }
    }

    if (chunks) {
      for (const chunk of chunks) {
        const metadata = chunk.metadata as Record<string, unknown> | null;
        const imageUrl = metadata?.image_url as string | undefined;

        if (imageUrl && chunk.entity_name) {
          let assetType = 'npc'; // recognized fallback
          const chunkType = chunk.chunk_type as string;
          if (chunkType.startsWith('npc')) assetType = 'npc';
          else if (chunkType === 'location') assetType = 'location';
          else if (chunkType === 'item') assetType = 'item';
          else if (chunkType === 'monster' || chunkType === 'encounter') assetType = 'monster';
          else if (chunkType === 'faction') assetType = 'faction';
          else if (chunkType === 'scene') assetType = 'scene';
          else if (chunkType.startsWith('character')) assetType = 'character';

          assets.push({
            type: assetType,
            key: generateAssetKey(chunk.entity_name),
            name: chunk.entity_name,
          });
        }
      }
    }
  } catch (error) {
    logger.warn('[AIService] Failed to fetch campaign assets for prompt:', error);
    return '';
  }

  if (assets.length === 0) {
    cachedAssets = null;
    return '';
  }

  // Cache assets for post-processing use (insertAssetTags)
  cachedAssets = { campaignId: starterCampaignId, assets };

  // Format for AI prompt with strong instructions
  const prompt = `
<available_visual_assets>
<MANDATORY_REQUIREMENT>
You MUST include [ASSET:type:key] tags when introducing ANY entity from this list.
These tags display artwork to the player - WITHOUT the tag, the player sees NO image.

FORMAT: Place the tag IMMEDIATELY BEFORE the entity's name on first mention.
CORRECT: "As you enter, [ASSET:npc:elara] Elara greets you."
INCORRECT: "As you enter, Elara greets you [ASSET:npc:elara]."
</MANDATORY_REQUIREMENT>

${assets.map((a) => `- ${a.name} [ASSET:${a.type}:${a.key}]`).join('\n')}
</available_visual_assets>`;

  return prompt;
}

/**
 * Get currently cached assets
 */
export function getCachedAssets(): AssetInfo[] {
  return cachedAssets?.assets || [];
}
