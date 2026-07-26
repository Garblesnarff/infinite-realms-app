/**
 * One normalization rule for every monster lookup key in combat.
 *
 * It lives in its own module because two independent catalogs consume it — the SRD JSON
 * and campaign-authored chunks — and the whole point is that a key written by one producer
 * and read by another cannot drift. Playtest run 15: the DM sent `srd:stone_golem`, the SRD
 * catalog holds `srd:stone-golem`, and a CR 10 creature with 178 HP fought as an 11 HP
 * generic NPC because the lookup lowercased but did not fold separators.
 *
 * Rule: trim, lowercase, drop a leading `srd:`, collapse every run of non-alphanumeric
 * characters to a single `-`, then trim leading/trailing `-`. `srd:stone_golem`,
 * `srd:stone-golem`, `stone_golem`, `Stone Golem` and `STONE GOLEM` all become `stone-golem`.
 *
 * Catalog keys and incoming ids both go through this function, so the two cannot diverge.
 */
export const normalizeMonsterKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^srd:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Normalized key split into its word tokens, for near-miss matching. */
export const monsterKeyTokens = (value: string): string[] =>
  normalizeMonsterKey(value).split('-').filter(Boolean);
