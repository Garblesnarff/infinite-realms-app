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
 * Prepared asset item with pre-compiled regex pattern for performance
 */
export interface PreparedMatchItem {
  text: string;
  asset: AssetInfo;
  pattern: RegExp;
  isSingleWordOrAlias: boolean;
}

const TITLES = [
  'sir',
  'lady',
  'lord',
  'captain',
  'general',
  'doctor',
  'master',
  'king',
  'queen',
  'baron',
  'baroness',
  'count',
  'countess',
  'madam',
  'madame',
  'professor',
  'dame',
  'archmage',
  'chancellor',
  'duke',
  'duchess',
  'prince',
  'princess',
];

const STOP_WORDS = new Set([
  ...TITLES,
  'the',
  'an',
  'a',
  'manager',
  'guard',
  'innkeeper',
  'tavern',
  'chef',
  'cook',
  'baker',
  'smith',
  'butcher',
  'of',
  'and',
  'or',
  'in',
  'on',
  'at',
  'to',
  'from',
  'with',
]);

/**
 * Generate candidate aliases for NPC assets (quoted epithets stripped, titles stripped, short forms)
 */
export function generateNpcAliases(fullName: string): string[] {
  const candidates = new Set<string>();
  const trimmedFull = fullName.trim();
  if (!trimmedFull) return [];

  candidates.add(trimmedFull);

  // Unquoted form if quotes exist
  if (trimmedFull.includes('"') || trimmedFull.includes("'")) {
    const unquoted = trimmedFull.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
    if (unquoted) candidates.add(unquoted);

    // Form outside quotes
    const outsideQuotes = trimmedFull.replace(/["'][^"']*["']/g, '').replace(/\s+/g, ' ').trim();
    if (outsideQuotes) candidates.add(outsideQuotes);
  }

  // Handle titles/honorifics stripping
  const lowerFull = trimmedFull.toLowerCase();
  let titleStripped = '';
  for (const title of TITLES) {
    if (lowerFull.startsWith(title + ' ')) {
      titleStripped = trimmedFull.slice(title.length + 1).trim();
      if (titleStripped) candidates.add(titleStripped);
      break;
    }
  }

  // Handle " of " stripping (e.g., Sir Gareth of Oakhaven -> Sir Gareth)
  const ofIndex = lowerFull.indexOf(' of ');
  if (ofIndex > 0) {
    const beforeOf = trimmedFull.slice(0, ofIndex).trim();
    if (beforeOf) candidates.add(beforeOf);
  }

  if (titleStripped) {
    const lowerTitleStripped = titleStripped.toLowerCase();
    const ofIndexStripped = lowerTitleStripped.indexOf(' of ');
    if (ofIndexStripped > 0) {
      const beforeOfStripped = titleStripped.slice(0, ofIndexStripped).trim();
      if (beforeOfStripped) candidates.add(beforeOfStripped);
    }
  }

  // Leading proper-noun run / first word
  for (const cand of Array.from(candidates)) {
    const words = cand.replace(/["']/g, '').split(/\s+/);
    if (words.length > 1) {
      const firstWord = words[0].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
      if (firstWord && /^[A-Z]/.test(firstWord) && !STOP_WORDS.has(firstWord.toLowerCase())) {
        candidates.add(firstWord);
      }
    }
  }

  // Clean and filter candidates
  const validAliases: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate.replace(/^[^a-zA-Z0-9"'`]+|[^a-zA-Z0-9"'`]+$/g, '').trim();
    if (clean.length < 2) continue;

    // Check if single-word candidate is in stop words
    const isSingleWord = !clean.includes(' ');
    if (isSingleWord && STOP_WORDS.has(clean.toLowerCase())) {
      continue;
    }

    validAliases.push(clean);
  }

  return validAliases;
}

// Module-level cache for assets to avoid re-fetching
let cachedAssets: { campaignId: string; assets: AssetInfo[] } | null = null;

// ⚡ Bolt: Cache for prepared assets (sorted and with compiled regexes)
// to avoid O(N log N) sorting and O(N) regex compilation on every AI response.
let preparedAssetsCache: {
  originalAssets: AssetInfo[];
  prepared: PreparedMatchItem[];
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
 * Internal helper to prepare assets for processing (alias generation, sorting, and regex compilation)
 */
function getPreparedAssets(assets: AssetInfo[]): PreparedMatchItem[] {
  // Return cached version if it's the exact same array reference
  if (preparedAssetsCache && preparedAssetsCache.originalAssets === assets) {
    return preparedAssetsCache.prepared;
  }

  const candidateMap = new Map<AssetInfo, string[]>();
  const aliasToAssetKeys = new Map<string, Set<string>>();

  for (const asset of assets) {
    const isNpc = asset.type === 'npc' || asset.type === 'character';
    const aliases = isNpc ? generateNpcAliases(asset.name) : [asset.name];
    candidateMap.set(asset, aliases);

    for (const alias of aliases) {
      const lowerAlias = alias.toLowerCase().trim();
      if (!aliasToAssetKeys.has(lowerAlias)) {
        aliasToAssetKeys.set(lowerAlias, new Set());
      }
      aliasToAssetKeys.get(lowerAlias)!.add(asset.key);
    }
  }

  const prepared: PreparedMatchItem[] = [];

  for (const asset of assets) {
    const aliases = candidateMap.get(asset) || [asset.name];
    for (const alias of aliases) {
      const lowerAlias = alias.toLowerCase().trim();
      const isFullName = alias.toLowerCase() === asset.name.toLowerCase();

      const matchingKeys = aliasToAssetKeys.get(lowerAlias);
      if (!isFullName && matchingKeys && matchingKeys.size > 1) {
        continue;
      }

      prepared.push({
        text: alias,
        asset,
        pattern: new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i'),
        isSingleWordOrAlias: !alias.includes(' ') || !isFullName,
      });
    }
  }

  // Sort match items by text length (longest first) so fuller forms win
  prepared.sort((a, b) => b.text.length - a.text.length);

  preparedAssetsCache = {
    originalAssets: assets,
    prepared,
  };

  return prepared;
}

/**
 * Post-process AI response to automatically insert asset tags
 * Scans for entity names and inserts [ASSET:type:key] before them
 */
export function insertAssetTags(text: string, assets: AssetInfo[]): string {
  let result = text;

  if (!assets || assets.length === 0) return guardAssetTags(result);

  const preparedItems = getPreparedAssets(assets);

  for (const item of preparedItems) {
    const { asset, text: aliasText, pattern } = item;

    // Skip if tag already exists for this asset
    const existingTag = `[ASSET:${asset.type}:${asset.key}]`;
    if (result.includes(existingTag)) continue;

    const match = result.match(pattern);

    if (match && match.index !== undefined) {
      const matchedStr = match[0];

      // Capitalization context check:
      // Must start with an uppercase letter to ensure proper-noun usage.
      const matchedChar = result[match.index];
      if (!/^[A-Z]/.test(matchedChar)) continue;

      // For multi-word candidates, enforce that capitalized words in aliasText
      // are also capitalized in matchedStr (to avoid matching common nouns like "the manager").
      if (aliasText.includes(' ')) {
        const aliasWords = aliasText.split(/\s+/);
        const matchedWords = matchedStr.split(/\s+/);
        let capitalizationMismatch = false;

        for (let i = 0; i < Math.min(aliasWords.length, matchedWords.length); i++) {
          const aliasWord = aliasWords[i].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
          const matchedWord = matchedWords[i].replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
          if (
            aliasWord &&
            /^[A-Z]/.test(aliasWord) &&
            !['The', 'An', 'A', 'Of'].includes(aliasWord)
          ) {
            if (!matchedWord || !/^[A-Z]/.test(matchedWord)) {
              capitalizationMismatch = true;
              break;
            }
          }
        }

        if (capitalizationMismatch) continue;
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
