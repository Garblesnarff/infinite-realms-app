/**
 * One normalization rule for every monster lookup key in combat.
 *
 * It lives in its own module because two independent catalogs consume it — the SRD JSON
 * and campaign-authored chunks — and the whole point is that a key written by one producer
 * and read by another cannot drift. Playtest run 15: the DM sent `srd:stone_golem`, the SRD
 * catalog holds `srd:stone-golem`, and a CR 10 creature with 178 HP fought as an 11 HP
 * generic NPC because the lookup lowercased but did not fold separators.
 *
 * Run 16 showed that *collapsing* separators to `-` was still not enough. The DM writes the
 * same creature with and without word breaks — `srd:stonegolem` one turn, `srd:stone-golem`
 * the next — and a collapsing rule maps those to `stonegolem` and `stone-golem`, two
 * different keys. The same creature resolved correctly twice and fell back to generic
 * 11 HP seven times in a single session, decided purely by the DM's spelling.
 *
 * Rule: trim, lowercase, drop a leading `srd:`, then **remove** every non-alphanumeric
 * character, and drop a leading `the`. `srd:stone_golem`, `srd:stone-golem`,
 * `srd:stonegolem`, `stone golem`, `Stone Golem` and `STONE GOLEM` all become `stonegolem`;
 * `The Doorkeeper` and `Doorkeeper` both become `doorkeeper`.
 *
 * Verified collision-free across all 334 SRD catalog ids and all 334 catalog names — see
 * `__tests__/monster-key.test.ts`, which recomputes the check from the catalog on every run
 * rather than trusting this comment.
 *
 * Catalog keys and incoming ids both go through this function, so the two cannot diverge.
 */

/**
 * The definite article the DM prepends inconsistently: "The Doorkeeper" and "Doorkeeper"
 * flipped a Run 16 lookup between a real stat block and generic NPC filler. Anchored to a
 * word boundary so `theurgist` keeps its first three letters.
 */
const LEADING_ARTICLE = /^the-/;

/**
 * Word-boundary-preserving intermediate form: `Stone Golem` → `stone-golem`.
 *
 * Kept separate from the lookup key because near-miss matching in `srd-monster-resolution`
 * works on tokens, and a key with its separators removed has no tokens left to match on.
 * The lookup key is the strict form; this is the readable one.
 */
const hyphenated = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^srd:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(LEADING_ARTICLE, '');

/**
 * The canonical lookup key. Separator-insensitive by construction: separators are removed,
 * not normalized, so no spelling of the word break can produce a different key.
 */
export const normalizeMonsterKey = (value: string): string => hyphenated(value).replace(/-/g, '');

/**
 * Normalized key split into its word tokens, for near-miss matching.
 *
 * Tokens necessarily come from the hyphenated form: `stonegolem`, written without a break,
 * carries no boundary information and so tokenizes as a single token. That is honest — the
 * information is not there — and exact lookup already handles that spelling.
 */
export const monsterKeyTokens = (value: string): string[] =>
  hyphenated(value).split('-').filter(Boolean);
