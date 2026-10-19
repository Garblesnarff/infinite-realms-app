/**
 * Extract the spell_id from the sheet Cast button's `[spell_id=<id>, ...]` tag (#709).
 *
 * Pure, no DB imports — safe to unit-test in the vitest job.
 *
 * @module server/services/combat/spell-cast-tag
 */

/** Extract the spell_id from a `[spell_id=<id>, ...]` tag, if present. */
export function extractSpellIdFromPrompt(prompt: string): string | null {
  const match = prompt.match(/\[spell_id=([^\],\s]+)/);
  return match?.[1] ?? null;
}
