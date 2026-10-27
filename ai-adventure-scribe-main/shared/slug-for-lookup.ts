/**
 * The slug rule for matching a campaign entity name to its uploaded art.
 * scripts/upload-campaign-assets.ts links art with it, and the game client
 * matches DM prose with it. Keep one copy: change it here only.
 */
export function slugForLookup(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
