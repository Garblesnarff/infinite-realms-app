import { generateAssetKey } from './asset-key';

function deriveAssetDisplayName(normalizedKey: string): string {
  return normalizedKey
    .split('-')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/**
 * Normalize asset tags that the model may format incorrectly.
 * Fixes malformed keys, strips markdown emphasis wrapped around bare tags,
 * and restores a visible display name when the model emits only a tag.
 */
export function normalizeAssetTagKeysInContent(content: string): string {
  const loosePattern = /\[ASSET:(character|npc|location|monster|item|scene|entity):([^\]]+)\]/gi;

  return content.replace(loosePattern, (fullMatch, type, rawKey, offset, wholeString) => {
    const normalized = generateAssetKey(rawKey);
    const normalizedTag = `[ASSET:${type}:${normalized}]`;
    const derivedName = deriveAssetDisplayName(normalized);

    if (!derivedName) {
      return normalizedTag;
    }

    const beforeTag = wholeString.slice(0, offset).replace(/[\s"'`*_]+$/, '');
    const firstWord = derivedName.split(' ')[0].toLowerCase();
    const afterTag = wholeString.slice(offset + fullMatch.length).replace(/^[^a-zA-Z]+/, '');
    const lastWordBeforeTag = beforeTag.match(/([a-zA-Z]+)$/)?.[1]?.toLowerCase();
    const nameAlreadyPresent = afterTag.toLowerCase().startsWith(firstWord);
    const nameAlreadyPrepended = beforeTag.toLowerCase().endsWith(derivedName.toLowerCase());
    const firstWordAlreadyPrepended = lastWordBeforeTag === firstWord;
    const isStandaloneTag = beforeTag.length === 0 && afterTag.length === 0;

    if (
      !nameAlreadyPresent &&
      !nameAlreadyPrepended &&
      !firstWordAlreadyPrepended &&
      !isStandaloneTag
    ) {
      return `${derivedName} ${normalizedTag}`;
    }

    return normalizedTag;
  });
}

export function normalizeAssetTagsInContent(content: string): string {
  return normalizeAssetTagKeysInContent(content)
    .replace(/\*\*\s*(\[ASSET:[^\]]+\])\s*\*\*/gi, '$1')
    .replace(/\*\s*(\[ASSET:[^\]]+\])\s*\*/gi, '$1');
}
