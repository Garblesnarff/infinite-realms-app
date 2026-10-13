import srdSpellsJson from '@/data/srd/spells.json';
import srdWeaponsJson from '@/data/srd/weapons.json';

/**
 * #400 — deterministic sheet-only filter for the DM's suggested action options.
 *
 * The `<options_field>` prompt sentence tells the model to offer only attacks and spells the
 * character can actually use, but a sentence is not a guarantee. This module enforces it
 * without a model call: an option whose bold title names a real SRD spell or weapon that is
 * not on the character sheet is dropped. Anything not recognizable as a spell or attack
 * (a skill use, a social move, a feature the SRD data does not name) passes through untouched —
 * dropping what we cannot identify would eat legitimate suggestions.
 */

/** Attacks and spells the character sheet says the character can use (normalized on read). */
export interface SheetCombatNames {
  attacks: string[];
  spells: string[];
}

export const normalizeCombatName = (value: string): string =>
  value.toLowerCase().trim().replace(/\s+/g, ' ');

const nameSet = (entries: Array<{ name?: unknown }>): ReadonlySet<string> =>
  new Set(
    entries
      .map((entry) =>
        typeof entry.name === 'string' ? normalizeCombatName(entry.name) : '',
      )
      .filter(Boolean),
  );

const SRD_SPELL_NAMES = nameSet(srdSpellsJson as Array<{ name?: unknown }>);
const SRD_WEAPON_NAMES = nameSet(srdWeaponsJson as Array<{ name?: unknown }>);

/** Everyone can throw a punch; it is never sheet equipment. */
const UNARMED_STRIKE = 'unarmed strike';

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];

/**
 * The sheet's usable attacks and spells, from the owned character record (the full sheet, not
 * the session context's limited payload). Attacks are equipment entries that name a real SRD
 * weapon (an "attack with Shortsword" suggestion is only legal when the sheet actually lists
 * a shortsword); unarmed strike is always available. Spells are the cantrips plus the known,
 * prepared, pact and ritual lists. Returns null when there is no sheet: filtering against an
 * empty sheet would drop legitimate suggestions, so the caller must treat null as "do not filter".
 */
export function extractSheetCombatNames(
  characterRecord: Record<string, unknown> | null | undefined,
): SheetCombatNames | null {
  if (!characterRecord) return null;
  const attacks = stringList(characterRecord.equipment)
    .map(normalizeCombatName)
    .filter((name) => SRD_WEAPON_NAMES.has(name));
  if (!attacks.includes(UNARMED_STRIKE)) attacks.push(UNARMED_STRIKE);
  const spells = [
    ...stringList(characterRecord.cantrips),
    ...stringList(characterRecord.knownSpells),
    ...stringList(characterRecord.preparedSpells),
    ...stringList(characterRecord.pactMagicSpells),
    ...stringList(characterRecord.ritualSpells),
  ].map(normalizeCombatName);
  return { attacks, spells };
}

const BOLD_TITLE_PATTERN = /\*\*([^*]+)\*\*/;
const LEADING_MARKER_PATTERN = /^(?:\*\*)?[A-Z0-9]+\.(?:\*\*)?\s+/;

/** The bold action phrase of a DM option ("A. **Fire Bolt**, hurl flame" -> "Fire Bolt"). */
export function extractOptionTitle(option: string): string {
  const bold = BOLD_TITLE_PATTERN.exec(option);
  if (bold) return bold[1].trim();
  return option.replace(LEADING_MARKER_PATTERN, '').split(',')[0].trim();
}

/**
 * Leading action verbs the DM puts in front of the named thing ("Attack with Longsword",
 * "Cast Fireball"). The word boundary keeps "Fireball" and "Fire Bolt" intact.
 */
const LEADING_VERB_PATTERN =
  /^(cast|attack|strike|hit|shoot|fire|swing|hurl|throw|launch|loose)\b\s*(with|at|using|from)?\s*/i;

const stripLeadingVerb = (title: string): string =>
  title.replace(LEADING_VERB_PATTERN, '').trim();

/**
 * Drop the options that name a spell or attack the character cannot use. An option is judged
 * to name a spell/attack only when its title (or the title minus a leading action verb) is a
 * real SRD spell or weapon name; sheet membership is then the keep/drop gate. Anything not
 * recognizable as a spell or attack — a skill use, a social move, a feature the SRD data
 * does not name, or a non-string entry the schema allowed through — passes through untouched.
 * Returns the surviving options in order.
 */
export function filterOptionsAgainstSheet(
  options: unknown[],
  sheet: SheetCombatNames,
): unknown[] {
  const sheetAttacks = new Set(sheet.attacks.map(normalizeCombatName));
  const sheetSpells = new Set(sheet.spells.map(normalizeCombatName));
  const isOnSheet = (name: string): boolean =>
    sheetAttacks.has(name) || sheetSpells.has(name);
  const isIllegalName = (name: string): boolean =>
    !isOnSheet(name) && (SRD_SPELL_NAMES.has(name) || SRD_WEAPON_NAMES.has(name));
  return options.filter((option) => {
    if (typeof option !== 'string') return true;
    const title = normalizeCombatName(extractOptionTitle(option));
    if (!title || isOnSheet(title)) return true;
    if (isIllegalName(title)) return false;
    // The full title was not a recognizable name ("Attack with Longsword"): judge the
    // verb-less core. An exact illegal title ("Fireball") was already dropped above.
    const core = normalizeCombatName(stripLeadingVerb(title));
    if (!core || core === title) return true;
    return !isIllegalName(core);
  });
}
