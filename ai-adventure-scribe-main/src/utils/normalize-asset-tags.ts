import { generateAssetKey, stripKeyPossessiveS } from './asset-key';

const LEADING_ARTICLE_PATTERN = /^(?:the|an|a)\s+/i;
const ASSET_NAME_WORD_PATTERN = /[a-z0-9]+(?:['’-][a-z0-9]+)*/gi;
const MIN_VISIBLE_NAME_PREFIX_WORDS = 2;
const MIN_VISIBLE_NAME_SUFFIX_WORDS = 1;

export function deriveAssetDisplayName(normalizedKey: string): string {
  return normalizedKey
    .split('-')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

function normalizeLeadingArticle(value: string): string {
  return value.replace(LEADING_ARTICLE_PATTERN, '').trim();
}

function startsWithWholeName(value: string, name: string): boolean {
  if (!value.startsWith(name)) return false;

  const nextCharacter = value[name.length];
  return !nextCharacter || !/[a-zA-Z0-9]/.test(nextCharacter);
}

function endsWithWholeName(value: string, name: string): boolean {
  if (!value.endsWith(name)) return false;

  const previousCharacter = value[value.length - name.length - 1];
  return !previousCharacter || !/[a-zA-Z0-9]/.test(previousCharacter);
}

function getComparableWords(value: string): string[] {
  // Strip diacritics before matching so "Möbius" compares as "mobius" against
  // slug-derived names (#2343 B5). [a-z] in the word pattern is ASCII-only, so
  // without this the ö splits the word and the prefix match fails.
  // Hyphens are word separators too: the display form "Wall-Mouth" and the
  // key-derived "Wall Mouth" are the same name in two spellings, and a possessive
  // is the name itself ("the Vitruvian Spider's"), not a different phrase. Either
  // spelling standing next to the tag means the name is already visible; reading
  // them as different words is what printed both (#2513).
  const asciiFolded = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]+/g, ' ');
  return (
    asciiFolded
      .match(ASSET_NAME_WORD_PATTERN)
      ?.map((word) => word.toLowerCase().replace(/['’]s$/, '')) ?? []
  );
}

/**
 * One text for comparing a visible name against the key-derived one, with the
 * same two equivalences `getComparableWords` applies word-wise: hyphens read as
 * spaces, and a possessive ending is the name itself.
 */
function comparableNameText(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/['’]s(?=\s|$)/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Match a visible multi-word prefix of a derived name. Asset keys can include
 * a parenthetical or zone qualifier that the narration intentionally omits,
 * such as "The Throat of Basalt" for
 * "the-throat-of-basalt-upper-chasm".
 */
function startsWithVisibleNamePrefix(value: string, name: string): boolean {
  const valueWords = getComparableWords(value);
  const nameWords = getComparableWords(name);
  let matchedWords = 0;

  while (
    matchedWords < valueWords.length &&
    matchedWords < nameWords.length &&
    valueWords[matchedWords] === nameWords[matchedWords]
  ) {
    matchedWords++;
  }

  return matchedWords >= MIN_VISIBLE_NAME_PREFIX_WORDS;
}

function startsWithVisibleNameSuffix(value: string, name: string, originalValue: string): boolean {
  // A one-word overlap is only evidence of a spelled-out name when the narration capitalises it
  // ("Corrupted Shard"); lowercase prose like "forest lay quiet" is just a word (#2436).
  const firstWordCapitalised = /^[A-Z]/.test(originalValue);
  const valueWords = getComparableWords(value);
  const nameWords = getComparableWords(name);
  const maxMatchLength = Math.min(valueWords.length, nameWords.length);

  for (
    let matchLength = maxMatchLength;
    matchLength >= MIN_VISIBLE_NAME_SUFFIX_WORDS;
    matchLength--
  ) {
    const valuePrefix = valueWords.slice(0, matchLength);
    const nameSuffix = nameWords.slice(-matchLength);
    if (matchLength === 1 && !firstWordCapitalised) continue;
    if (valuePrefix.every((word, index) => word === nameSuffix[index])) {
      return true;
    }
  }

  return false;
}

function endsWithVisibleNamePrefix(value: string, name: string): boolean {
  const valueWords = getComparableWords(value);
  const nameWords = getComparableWords(name);
  const maxPrefixLength = Math.min(valueWords.length, nameWords.length);

  for (
    let prefixLength = maxPrefixLength;
    prefixLength >= MIN_VISIBLE_NAME_PREFIX_WORDS;
    prefixLength--
  ) {
    const valueSuffix = valueWords.slice(-prefixLength);
    const namePrefix = nameWords.slice(0, prefixLength);
    if (valueSuffix.every((word, index) => word === namePrefix[index])) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether the full asset name, or a visible multi-word prefix of it, is
 * already visible immediately before or after a tag. Leading articles are
 * optional on either side of the match.
 */
export function isAssetNamePresentAroundTag(
  content: string,
  tagStart: number,
  tagLength: number,
  derivedName: string,
): boolean {
  const normalizedName = normalizeLeadingArticle(derivedName).toLowerCase();
  if (!normalizedName) return false;

  const beforeTag = content.slice(0, tagStart).replace(/[\s"'`*_]+$/, '');
  const afterTag = content.slice(tagStart + tagLength).replace(/^[^a-zA-Z]+/, '');
  const normalizedBeforeTag = comparableNameText(normalizeLeadingArticle(beforeTag).toLowerCase());
  const originalAfterTag = normalizeLeadingArticle(afterTag);
  const normalizedAfterTag = comparableNameText(originalAfterTag.toLowerCase());
  const comparableName = comparableNameText(normalizedName);

  return (
    endsWithWholeName(normalizedBeforeTag, comparableName) ||
    startsWithWholeName(normalizedAfterTag, comparableName) ||
    endsWithVisibleNamePrefix(normalizedBeforeTag, comparableName) ||
    startsWithVisibleNamePrefix(normalizedAfterTag, comparableName) ||
    startsWithVisibleNameSuffix(normalizedAfterTag, comparableName, originalAfterTag)
  );
}

/**
 * Normalize asset tags that the model may format incorrectly.
 * Fixes malformed keys, strips markdown emphasis wrapped around bare tags,
 * and restores a visible display name when the model emits only a tag.
 */
export function normalizeAssetTagKeysInContent(content: string): string {
  const loosePattern =
    /\[ASSET:(character|npc|location|monster|item|faction|scene|entity):([^\]]+)\]/gi;

  return content.replace(loosePattern, (fullMatch, type, rawKey, offset, wholeString) => {
    const normalized = generateAssetKey(rawKey);
    const normalizedTag = `[ASSET:${type}:${normalized}]`;
    const derivedName = deriveAssetDisplayName(normalized);

    if (!derivedName) {
      return normalizedTag;
    }

    const beforeTag = wholeString.slice(0, offset).replace(/[\s"'`*_]+$/, '');
    const afterTag = wholeString.slice(offset + fullMatch.length).replace(/^[^a-zA-Z]+/, '');
    // A model may emit an old-style key ("the-bland-ones-disciple") built without the
    // possessive strip; treat its stripped form ("the-bland-one-disciple") as the same
    // entity so the visible possessive name is recognized and no second name is added.
    const strippedDerivedName = deriveAssetDisplayName(stripKeyPossessiveS(normalized));
    const nameAlreadyPresent =
      isAssetNamePresentAroundTag(wholeString, offset, fullMatch.length, derivedName) ||
      (strippedDerivedName !== derivedName &&
        isAssetNamePresentAroundTag(wholeString, offset, fullMatch.length, strippedDerivedName));
    const isStandaloneTag = beforeTag.length === 0 && afterTag.length === 0;

    if (!nameAlreadyPresent && !isStandaloneTag) {
      const precedingArticle = /(?:^|\s)(?:the|an|a)$/i.test(beforeTag);
      const nameToInsert = precedingArticle ? normalizeLeadingArticle(derivedName) : derivedName;
      return `${nameToInsert} ${normalizedTag}`;
    }

    return normalizedTag;
  });
}

export function normalizeAssetTagsInContent(content: string): string {
  // First strip emphasis around bare tags, then normalize keys and prepend names.
  // This ensures name prepending doesn't accidentally happen "outside" the emphasis
  // while the tag is "inside" the emphasis.
  const stripped = content
    .replace(/\*\*\s*(\[ASSET:[^\]]+\])\s*\*\*/gi, '$1')
    .replace(/\*\s*(\[ASSET:[^\]]+\])\s*\*/gi, '$1');

  return normalizeAssetTagKeysInContent(stripped);
}
