/**
 * Asset Key Generation Utility
 *
 * Generates URL-friendly keys from entity names for use in asset tags.
 * This is the single source of truth for key generation - all code that
 * creates or matches [ASSET:type:key] tags should use this function.
 *
 * Example: "Remy "The Manager"" -> "remy-the-manager"
 */

/**
 * Generate a URL-friendly key from an entity name.
 * Used for asset tags like [ASSET:npc:remy-the-manager]
 *
 * @param name - The entity name (e.g., "Remy \"The Manager\"")
 * @returns A lowercase, hyphenated key (e.g., "remy-the-manager")
 */
export function generateAssetKey(name: string): string {
  return name
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Strip a possessive 's before removing quotes ("The Bland One's Disciple" ->
    // "the-bland-one-disciple", not "the-bland-ones-disciple"): the possessive s is
    // grammar, not name. Without this the key-derived display name ("The Bland Ones
    // Disciple") never matches the visible possessive ("The Bland One's Disciple") in
    // normalizeAssetTagKeysInContent, which then prepends a second name (#267).
    .replace(/['’]s\b/g, '')
    .replace(/[""''«»`"']/g, '') // Remove all quote variants (Unicode + ASCII)
    .replace(/[^a-z0-9\s-]/g, '') // Remove remaining special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .trim();
}

/**
 * Strip a trailing "s" from each hyphen-separated word in a key, but only when
 * the s is a possessive remnant: the stem must appear with 's in one of the
 * known entity names. Old-style keys were built without the possessive strip
 * (e.g. "the-bland-ones-disciple" for "The Bland One's Disciple"); the stripped
 * form ("the-bland-one-disciple") is the same entity and must match. Without
 * the known-names guard, "thieves" becomes "thieve" and a lookup for "bats"
 * resolves to a different entity "bat" (#292).
 *
 * Shared by tag normalization and asset lookup (#267, #292). It is NOT used by
 * generateAssetKey, which strips the possessive from the raw name before
 * hyphenation.
 */
export function stripKeyPossessiveS(key: string, knownNames: readonly string[] = []): string {
  const possessiveStems = new Set<string>();
  for (const name of knownNames) {
    // Mirror generateAssetKey's diacritic stripping: keys are NFKD-normalized
    // and lowercased, so "Mjölnir's" must yield the stem "mjolnir" — matching
    // the raw name would capture the fragment "lnir" instead.
    const ascii = name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    for (const match of ascii.matchAll(/([a-z0-9]+)['’]s\b/g)) {
      possessiveStems.add(match[1]);
    }
  }
  return key
    .split('-')
    .map((word) =>
      word.length > 2 && word.endsWith('s') && possessiveStems.has(word.slice(0, -1))
        ? word.slice(0, -1)
        : word,
    )
    .join('-');
}
