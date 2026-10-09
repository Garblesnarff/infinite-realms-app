/**
 * What a character can cast right now, for the DM feature gate (#217 step d1).
 *
 * Cantrips at will; prepared and known spells from `characters` and `character_spells`. A
 * wizard's known spells are the spellbook, which casts only what is prepared, or a ritual with no
 * slot.
 */

import { allSpells, getSpellByName, resolveCatalogSpell } from '../../data/spellData.js';

import type { characters } from '../../../../db/schema/index';

type CharacterRow = typeof characters.$inferSelect;

/**
 * A cast name the catalog does not hold, written as a spell's name: capitalised words, joined by
 * at most a small linking word ("Witch Bolt", "Tasha's Hideous Laughter"). "Cast a glance" and
 * "cast my net" are prose and never match.
 */
const SPELL_NAME_SHAPE = /^[A-Z][a-z'’-]+(?:\s+(?:(?:of|the|and|from)\s+)?[A-Z][a-z'’-]+){0,4}$/;

const compact = (name: string): string =>
  name
    .toLowerCase()
    .replace(/^[a-z]+['’]s\s+/, '')
    .replace(/[^a-z]/g, '');

const editDistance = (a: string, b: string): number => {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(
        (row[j] ?? 0) + 1,
        (next[j - 1] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    row = next;
  }
  return row[b.length] ?? 0;
};

/**
 * The catalog spell a player's spelling means, when it is close to exactly one: "Firebolt",
 * "Mage Armour", "Melf's Acid Arrow" and "Magic Missle" are Fire Bolt, Mage Armor, Acid Arrow and
 * Magic Missile, and are checked as those, not refused as unknown.
 */
export function catalogSpellSpelled(name: string): string | undefined {
  const exact = getSpellByName(name);
  if (exact) return exact.name;
  const wanted = compact(name);
  const tolerance = wanted.length >= 10 ? 2 : wanted.length >= 6 ? 1 : 0;
  const near = [
    ...new Set(
      allSpells
        .filter((spell) => editDistance(compact(spell.name), wanted) <= tolerance)
        .map((spell) => spell.name),
    ),
  ];
  return near.length === 1 ? near[0] : undefined;
}

/** The spells a player names straight after a cast verb, catalog or not. */
export const spellsNamed = (phrases: string[]): string[] =>
  phrases
    .filter((phrase) => SPELL_NAME_SHAPE.test(phrase))
    .map((phrase) => catalogSpellSpelled(phrase) ?? phrase);

/** One key per spell however it is written: the catalog id, or the name as a slug. */
export const spellKey = (ref: string): string =>
  resolveCatalogSpell(ref, ref)?.id ??
  ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const listedSpells = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);

/** What the character can cast now: cantrips at will, and their prepared or known spells. */
export async function castableSpells(character: CharacterRow): Promise<string[]> {
  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { characterSpells, spells } = await import('../../../../db/schema/index');
  const rows = await db
    .select({
      name: spells.name,
      level: spells.level,
      isPrepared: characterSpells.isPrepared,
      isAlwaysPrepared: characterSpells.isAlwaysPrepared,
    })
    .from(characterSpells)
    .innerJoin(spells, eq(characterSpells.spellId, spells.id))
    .where(eq(characterSpells.characterId, character.id));
  // A cantrip is cast at will, whatever its row says about preparing it.
  const cantrips = [
    ...listedSpells(character.cantrips),
    ...rows.filter((row) => row.level === 0).map((row) => row.name),
  ];
  const prepared = [
    ...listedSpells(character.preparedSpells),
    ...rows
      .filter((row) => row.isPrepared !== false || row.isAlwaysPrepared)
      .map((row) => row.name),
  ];
  const known = [...listedSpells(character.knownSpells), ...rows.map((row) => row.name)];
  // A wizard's known spells are the spellbook: from it they cast what they prepared, and a ritual
  // with no slot (RP-13). With nothing recorded as prepared, nothing says what that is, so the
  // whole book stands, as before: a false refusal is worse than a missed one.
  if ((character.class ?? '').toLowerCase() === 'wizard' && prepared.length) {
    return [
      ...cantrips,
      ...prepared,
      ...listedSpells(character.ritualSpells),
      ...known.filter((ref) => resolveCatalogSpell(ref, ref)?.ritual),
    ];
  }
  return [...cantrips, ...prepared, ...known];
}
