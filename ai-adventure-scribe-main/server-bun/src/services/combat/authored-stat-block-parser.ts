/**
 * Parser for campaign-authored monster stat blocks.
 *
 * 163 campaign bibles ship original creatures with authored numbers living as markdown
 * in `campaign_chunks.content`. Nothing in combat ever read them, so the Gluten Golem's
 * authored 90 HP fought as an 11 HP generic NPC and every playtest fight ended in one or
 * two exchanges.
 *
 * The governing constraint is that a WRONG stat is invisible in play while a FAILED parse
 * can be logged. So every field here is keyed on an explicit label and a value shape; there
 * is no "grab the first number you see" path. A block that does not say `HP:` yields no HP,
 * and that shows up in the audit as a fixable content bug rather than as a creature that
 * quietly fights at the wrong numbers.
 *
 * Parsing is per-field: a block with a readable HP but an unreadable AC yields the HP and
 * reports the AC as unparsed, rather than discarding both.
 */

/** A field the parser understands, whether or not a given block supplies it. */
export type AuthoredStatField =
  | 'maxHp'
  | 'armorClass'
  | 'speed'
  | 'size'
  | 'initiativeModifier'
  | 'challengeRating'
  | 'attackBonus'
  | 'damageDice'
  | 'damageType'
  | 'damageResistances'
  | 'damageImmunities'
  | 'damageVulnerabilities';

export interface ParsedStatBlock {
  maxHp?: number;
  armorClass?: number;
  speed?: number;
  size?: string;
  initiativeModifier?: number;
  challengeRating?: string;
  attackBonus?: number;
  damageDice?: string;
  damageType?: string;
  damageResistances?: string[];
  damageImmunities?: string[];
  damageVulnerabilities?: string[];
  /** Fields whose label was present but whose value did not match the required shape. */
  unparsedLabels: string[];
  /** Fields successfully read, in a stable order — the audit script's unit of coverage. */
  parsedFields: AuthoredStatField[];
}

/**
 * Labels are matched with the surrounding markdown emphasis optional, so `**HP:** 90`,
 * `*HP:* 90`, `HP: 90` and `- **Hit Points:** 90` all read the same. What is NOT optional
 * is the label itself and the colon: that is the entire safety property.
 */
const labelPattern = (labels: string[]): string =>
  `(?:^|[\\s*_>|-])\\**\\s*(?:${labels.join('|')})\\s*\\**\\s*:\\s*\\**\\s*`;

/**
 * Reads a labelled value with a required shape.
 *
 * `valuePattern` is anchored immediately after the label, so a label whose value is
 * malformed produces NO match — it is then reported as an unparsed label rather than
 * silently skipped or loosely re-scanned elsewhere in the text.
 */
const readLabelled = (
  content: string,
  labels: string[],
  valuePattern: string,
): { raw: string; groups: string[] } | null => {
  const re = new RegExp(`${labelPattern(labels)}(${valuePattern})`, 'i');
  const match = re.exec(content);
  if (!match) return null;
  return { raw: match[1] ?? '', groups: match.slice(1).map((g) => g ?? '') };
};

/** True when the label appears at all, regardless of whether its value was readable. */
const hasLabel = (content: string, labels: string[]): boolean =>
  new RegExp(labelPattern(labels), 'i').test(content);

const HP_LABELS = ['HP', 'Hit Points', 'HitPoints', 'Health'];
const AC_LABELS = ['AC', 'Armor Class', 'Armour Class'];
const SPEED_LABELS = ['Speed', 'Movement', 'Move'];
const SIZE_LABELS = ['Size'];
const INITIATIVE_LABELS = ['Initiative', 'Init'];
const CR_LABELS = ['CR', 'Challenge', 'Challenge Rating'];
const ATTACK_LABELS = ['Attack Bonus', 'To Hit', 'Attack', 'Hit Bonus'];
const DAMAGE_LABELS = ['Damage', 'Damage Dice', 'Dmg'];
const RESIST_LABELS = ['Resistances', 'Damage Resistances', 'Resistant To', 'Resistance'];
const IMMUNE_LABELS = ['Immunities', 'Damage Immunities', 'Immune To', 'Immunity'];
const VULN_LABELS = ['Vulnerabilities', 'Damage Vulnerabilities', 'Vulnerable To', 'Vulnerability'];

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

/** `90`, `90 (12d8+36)` — the integer must lead; a parenthetical dice expression may follow. */
const INTEGER = '\\d{1,4}(?!\\d*\\s*[dD]\\d)';
/** `+5`, `-1`, `5` — a signed modifier. */
const MODIFIER = '[+-]?\\d{1,2}\\b';
/** `2d10+4`, `1d6` — dice, optionally with a flat bonus. Never a bare number. */
const DICE = '\\d{1,2}\\s*[dD]\\s*\\d{1,3}(?:\\s*[+-]\\s*\\d{1,3})?';
/** A comma/slash separated word list, stopping at a line break or the next `**label**`. */
const WORD_LIST = '[A-Za-z][A-Za-z,;/&\\s-]*?(?=\\s*(?:\\*\\*|\\n|$))';

const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];

const splitList = (raw: string): string[] =>
  raw
    .split(/[,;/]|\band\b/i)
    .map((part) => part.trim().toLowerCase().replace(/\.$/, ''))
    .filter((part) => part.length > 0 && part !== 'none' && part !== 'n/a');

/**
 * Bibles embed other material inside a monster chunk behind a marker — Abyssal Descent's
 * "The Thing Below" carries a whole d20 random-encounter table inline after
 * `[TAG: ENCOUNTER_TABLE]`. Everything past the first such marker belongs to a different
 * creature or to no creature at all, so it is cut before parsing rather than read past.
 * A table row like `12. **Gloom Stalker** *HP:* 45` sitting inside another monster's chunk
 * is precisely the plausible-but-wrong stat this parser exists to refuse.
 */
const stripEmbeddedTables = (content: string): string => {
  const marker = /\[TAG:\s*[A-Z_]+\s*\]/i.exec(content);
  return marker ? content.slice(0, marker.index) : content;
};

/**
 * Parses an authored stat block. Never throws; an unreadable block yields empty results
 * with its offending labels named, which is what the caller logs and the audit counts.
 *
 * Markup-agnostic by construction: labels are matched with emphasis optional, so Eternal
 * Feast's `**HP:** 90 **AC:** 14` and Abyssal Descent's `*   *HP:* 80, *AC:* 14,` read
 * identically without either dialect being special-cased. Separators are irrelevant because
 * each value is anchored to its own label rather than to its position on the line.
 */
export function parseAuthoredStatBlock(rawContent: string): ParsedStatBlock {
  const parsed: ParsedStatBlock = { unparsedLabels: [], parsedFields: [] };
  if (!rawContent || typeof rawContent !== 'string') return parsed;

  const content = stripEmbeddedTables(rawContent);

  const record = <K extends AuthoredStatField>(field: K, value: ParsedStatBlock[K]): void => {
    parsed[field] = value;
    parsed.parsedFields.push(field);
  };

  /** Applies a field, or records the label as unparsed when it was present but unreadable. */
  const attempt = <K extends AuthoredStatField>(
    field: K,
    labels: string[],
    valuePattern: string,
    convert: (groups: string[]) => ParsedStatBlock[K] | undefined,
  ): void => {
    const hit = readLabelled(content, labels, valuePattern);
    const value = hit ? convert(hit.groups) : undefined;
    if (value !== undefined) {
      record(field, value);
    } else if (hasLabel(content, labels)) {
      parsed.unparsedLabels.push(labels[0]!);
    }
  };

  attempt('maxHp', HP_LABELS, INTEGER, ([raw]) => {
    const n = Number(raw);
    // A 0 HP creature is a content bug, not a combatant; refuse it rather than spawn a corpse.
    return Number.isInteger(n) && n > 0 ? n : undefined;
  });

  attempt('armorClass', AC_LABELS, INTEGER, ([raw]) => {
    const n = Number(raw);
    // AC outside 1-30 is not a d20 armour class; treating it as one would be a wrong stat.
    return Number.isInteger(n) && n >= 1 && n <= 30 ? n : undefined;
  });

  attempt('speed', SPEED_LABELS, INTEGER, ([raw]) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 && n <= 500 ? n : undefined;
  });

  attempt('size', SIZE_LABELS, `(?:${SIZES.join('|')})`, ([raw]) => raw.toLowerCase());

  attempt('initiativeModifier', INITIATIVE_LABELS, MODIFIER, ([raw]) => {
    const n = Number(raw);
    return Number.isInteger(n) && Math.abs(n) <= 20 ? n : undefined;
  });

  attempt('challengeRating', CR_LABELS, '\\d{1,2}(?:\\s*/\\s*\\d{1,2})?', ([raw]) =>
    raw.replace(/\s+/g, ''),
  );

  attempt('attackBonus', ATTACK_LABELS, `\\+\\s*\\d{1,2}\\b`, ([raw]) => {
    // Requires an explicit `+`: an attack line reading "Attack: slam" must not become +0,
    // and a bare number next to "Attack" is too ambiguous to trust.
    const n = Number(raw.replace(/\s+/g, ''));
    return Number.isInteger(n) && n >= 0 && n <= 20 ? n : undefined;
  });

  attempt('damageDice', DAMAGE_LABELS, DICE, ([raw]) => raw.replace(/\s+/g, '').toLowerCase());

  attempt(
    'damageType',
    DAMAGE_LABELS,
    `(?:${DICE})?[^\\n*]*?\\b(?:${DAMAGE_TYPES.join('|')})\\b`,
    ([raw]) => DAMAGE_TYPES.find((type) => new RegExp(`\\b${type}\\b`, 'i').test(raw)),
  );

  // Bibles commonly put the whole attack on one line — `**Attack:** +7 to hit, 2d10+4
  // bludgeoning` — with no separate `Damage:` label. Read the dice and type from the attack
  // line's own remainder, which keeps the value anchored to a label rather than scanned out
  // of free prose. Only fills what the Damage label did not already supply.
  const attackLine = readLabelled(content, ATTACK_LABELS, '[^\\n]*');
  if (attackLine) {
    if (parsed.damageDice === undefined) {
      const dice = new RegExp(DICE).exec(attackLine.raw);
      if (dice) record('damageDice', dice[0].replace(/\s+/g, '').toLowerCase());
    }
    if (parsed.damageType === undefined) {
      const type = DAMAGE_TYPES.find((t) => new RegExp(`\\b${t}\\b`, 'i').test(attackLine.raw));
      if (type) record('damageType', type);
    }
  }

  attempt('damageResistances', RESIST_LABELS, WORD_LIST, ([raw]) => {
    const list = splitList(raw);
    return list.length ? list : undefined;
  });

  attempt('damageImmunities', IMMUNE_LABELS, WORD_LIST, ([raw]) => {
    const list = splitList(raw);
    return list.length ? list : undefined;
  });

  attempt('damageVulnerabilities', VULN_LABELS, WORD_LIST, ([raw]) => {
    const list = splitList(raw);
    return list.length ? list : undefined;
  });

  // `damageType` shares its labels with `damageDice`, so a damage line that yields a type
  // but no dice would otherwise report the same label as both parsed and unparsed.
  if (parsed.damageDice !== undefined || parsed.damageType !== undefined) {
    parsed.unparsedLabels = parsed.unparsedLabels.filter((label) => label !== DAMAGE_LABELS[0]);
  }
  parsed.unparsedLabels = [...new Set(parsed.unparsedLabels)];

  return parsed;
}

/** The fields that decide whether a creature can fight at authored numbers at all. */
export const CORE_STAT_FIELDS: AuthoredStatField[] = ['maxHp', 'armorClass'];

export type ParseCoverage = 'full' | 'partial' | 'none';

/**
 * Coverage grading used by both the runtime log and the audit script, so the number a
 * developer sees in a coverage report means the same thing as the one in production logs.
 */
export function gradeCoverage(parsed: ParsedStatBlock): ParseCoverage {
  const core = CORE_STAT_FIELDS.filter((field) => parsed[field] !== undefined);
  if (core.length === CORE_STAT_FIELDS.length) return 'full';
  return core.length > 0 || parsed.parsedFields.length > 0 ? 'partial' : 'none';
}
