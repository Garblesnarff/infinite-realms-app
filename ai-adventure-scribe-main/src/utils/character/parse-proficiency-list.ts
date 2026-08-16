/**
 * Parsers for the persisted proficiency columns on `characters`.
 *
 * `skill_proficiencies`, `expertise_proficiencies`, `tool_proficiencies` and
 * `saving_throw_proficiencies` are all single TEXT columns holding a
 * comma-separated list. Two writers use two different delimiters:
 *
 *   - the creation wizard writes `join(',')`  (transformCharacterForStorage)
 *   - starter seeding writes  `join(', ')`    (starter-character-seeding)
 *
 * so every entry is trimmed on the way back in. The server-side combat path
 * already parses `saving_throw_proficiencies` this way
 * (server-bun/src/services/combat/data-access.ts); these helpers give the
 * frontend the same reading.
 */

import type { AbilityScores } from '@/types/character';

const ABILITY_KEYS: readonly (keyof AbilityScores)[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Split a persisted proficiency column into a trimmed, non-empty list.
 * Tolerates an already-parsed array, and null/undefined/empty (-> []).
 */
export function parseProficiencyList(value: unknown): string[] {
  const parts = Array.isArray(value)
    ? value.map((entry) => String(entry))
    : typeof value === 'string'
      ? value.split(',')
      : [];

  return parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

/**
 * As {@link parseProficiencyList}, but returns `undefined` when the column
 * holds nothing.
 *
 * The distinction matters: `calculateSkillModifiers` treats a *present*
 * `skillProficiencies` array as the complete, authoritative set and treats
 * `undefined` as "fall back to the class/race maps". Collapsing a null column
 * to `[]` would silently strip the fallback from every character whose column
 * was never written.
 */
export function parseOptionalProficiencyList(value: unknown): string[] | undefined {
  const parsed = parseProficiencyList(value);
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Parse `saving_throw_proficiencies` into ability keys.
 *
 * Stored lowercase ("strength,dexterity") by the wizard, but normalised here
 * anyway so a differently-cased row still resolves. Unrecognised entries are
 * dropped rather than trusted as ability names.
 */
export function parseSavingThrowProficiencies(
  value: unknown,
): (keyof AbilityScores)[] | undefined {
  const parsed = parseProficiencyList(value)
    .map((entry) => entry.toLowerCase())
    .filter((entry): entry is keyof AbilityScores =>
      ABILITY_KEYS.includes(entry as keyof AbilityScores),
    );

  return parsed.length > 0 ? parsed : undefined;
}
