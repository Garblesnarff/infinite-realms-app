import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { generateAssetKey } from '@/utils/asset-key';

// Asset type definition for post-processing
export interface AssetInfo {
  type: string;
  key: string;
  name: string;
}

// Module-level cache for assets to avoid re-fetching
let cachedAssets: { campaignId: string; assets: AssetInfo[] } | null = null;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\\]/g, '\\$&');
}

/**
 * Post-process AI response to automatically insert asset tags
 * Scans for entity names and inserts [ASSET:type:key] before them
 *
 * IMPORTANT: Only matches FULL asset names to avoid false positives.
 * e.g., "The Unwashed Dish" matches, but "dish" alone does NOT.
 */
export function insertAssetTags(text: string, assets: AssetInfo[]): string {
  if (!assets || assets.length === 0) return text;

  let result = text;

  // Sort assets by name length (longest first) to avoid partial matches
  const sortedAssets = [...assets].sort((a, b) => b.name.length - a.name.length);

  for (const asset of sortedAssets) {
    // Skip if tag already exists for this asset
    const existingTag = `[ASSET:${asset.type}:${asset.key}]`;
    if (result.includes(existingTag)) continue;

    // Match FULL name only (case-insensitive, word boundary)
    const pattern = new RegExp(`\\b${escapeRegex(asset.name)}\\b`, 'i');
    const match = result.match(pattern);

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

  return result;
}

/**
 * Apply asset tag post-processing to response text
 * Uses cached assets from fetchCampaignAssetsForPrompt
 */
export function applyAssetPostProcessing<T extends { text: string }>(response: T): T {
  if (!cachedAssets || !cachedAssets.assets.length) return response;
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
      supabase
        .from('starter_character_templates')
        .select('template_key, name, portrait_url')
        .eq('starter_campaign_id', starterCampaignId),
      supabase
        .from('campaign_chunks')
        .select('entity_name, chunk_type, metadata')
        .eq('campaign_id', starterCampaignId)
        .not('entity_name', 'is', null),
    ]);

    const characters = charactersResult.data;
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
