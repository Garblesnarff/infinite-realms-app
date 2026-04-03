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
    .replace(/[""''«»`"']/g, '') // Remove all quote variants (Unicode + ASCII)
    .replace(/[^a-z0-9\s-]/g, '') // Remove remaining special chars
    .replace(/\s+/g, '-') // Spaces to hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
    .trim();
}
