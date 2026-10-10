/**
 * What a character can cast right now, for the DM feature gate (#217 steps d1, d2).
 *
 * Cantrips at will; prepared and known spells from `characters` and `character_spells`. A
 * wizard's known spells are the spellbook, which casts only what is prepared, or a ritual with no
 * slot. A cleric, druid or paladin casts only what is prepared or always prepared.
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

/**
 * Classes that cast spells, and the level they start at. A name the catalog does not hold is a
 * spell claim only from one of these: a Fighter who casts Fishing Line is fishing (#217 step d2).
 */
const CASTER_FROM_LEVEL: Record<string, number> = {
  artificer: 1,
  bard: 1,
  cleric: 1,
  druid: 1,
  paladin: 2,
  ranger: 2,
  sorcerer: 1,
  warlock: 1,
  wizard: 1,
};

export const castsSpells = (character: CharacterRow): boolean =>
  character.level >= (CASTER_FROM_LEVEL[(character.class ?? '').toLowerCase()] ?? Infinity);

/**
 * Words only a spell's casting carries: a slot, a spell level, a saving throw or its DC. Bare
 * "save" and "spell" are ordinary English ("to save the boy", "my spell focus") and do not count.
 */
const SPELL_WORDS =
  /\b(?:slots?|cantrips?|ritual|upcast|(?:1st|2nd|3rd|[4-9]th)[- ]level|level\s*[1-9]|saving\s+throws?|DC\s*\d+)\b/i;
/**
 * Whether a name the catalog does not hold, cast in `sentence`, reads as a spell (#217 step d2,
 * #248 item 3): the sentence names a slot, a spell level, a saving throw or a DC, or the name is
 * a known spell name. A bare target ("at", "on", "upon", "against" straight after the name) no
 * longer suffices on its own: "cast Fishing Line at the heron" is fishing, not casting.
 * "Cast Fishing Line into the lake" is none of those, so it is not a claim; "into" and "toward"
 * name a place, not a target.
 */
const readsLikeASpell = (sentence: string, phrase: string): boolean =>
  SPELL_WORDS.test(sentence) || KNOWN_OFF_CATALOG_SPELL_NAMES.has(spellKey(phrase));

export interface NamedSpell {
  name: string;
  /** Not in the catalog: a claim only from a caster (`castsSpells`). */
  offCatalog: boolean;
}

/**
 * The spells a player names straight after a cast verb (`castPhrase`, whose first group is the
 * name): a catalog spell however it is spelled, or a name the catalog does not hold when its
 * sentence reads like a spell (`readsLikeASpell`).
 */
export const spellsNamed = (playerInput: string, castPhrase: RegExp): NamedSpell[] =>
  playerInput.split(/(?<=[.!?;])\s+/).flatMap((sentence) =>
    [...sentence.matchAll(castPhrase)].flatMap((match): NamedSpell[] => {
      const phrase = (match[1] ?? '').trim();
      if (!SPELL_NAME_SHAPE.test(phrase)) return [];
      const catalogName = catalogSpellSpelled(phrase);
      if (catalogName) return [{ name: catalogName, offCatalog: false }];
      return readsLikeASpell(sentence, phrase) ? [{ name: phrase, offCatalog: true }] : [];
    }),
  );

/** One key per spell however it is written: the catalog id, or the name as a slug. */
export const spellKey = (ref: string): string =>
  resolveCatalogSpell(ref, ref)?.id ??
  ref
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * 2014 spell names the SRD catalog does not hold, for the off-catalog claim check (#248 item 3).
 * A caster naming one straight after a cast verb claims a spell, cue or no cue: "I cast Witch
 * Bolt" is checked, while "cast Fishing Line at the heron" is not, because neither a cue nor a
 * name on this list says it is a spell. Names are facts, not rules text, so this list does not
 * widen the SRD-only rules surface; it grows only as new off-catalog cases are reported.
 */
const KNOWN_OFF_CATALOG_SPELL_NAMES = new Set(['Witch Bolt'].map(spellKey));

const listedSpells = (value: string | null | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);

const PREPARED_CASTERS = new Set(['cleric', 'druid', 'paladin']);

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
  const className = (character.class ?? '').toLowerCase();
  // A wizard's known spells are the spellbook: from it they cast what they prepared, and a ritual
  // with no slot (RP-13). With nothing recorded as prepared, nothing says what that is, so the
  // whole book stands, as before: a false refusal is worse than a missed one.
  if (className === 'wizard' && prepared.length) {
    return [
      ...cantrips,
      ...prepared,
      ...listedSpells(character.ritualSpells),
      ...known.filter((ref) => resolveCatalogSpell(ref, ref)?.ritual),
    ];
  }
  // A cleric, druid or paladin draws on their whole class list, but casts only what they prepared
  // today, and the spells their domain, circle or oath keeps always prepared (#217 step d2). The
  // same fail-open: with nothing recorded as prepared, everything recorded stands.
  if (PREPARED_CASTERS.has(className) && prepared.length) return [...cantrips, ...prepared];
  return [...cantrips, ...prepared, ...known];
}
