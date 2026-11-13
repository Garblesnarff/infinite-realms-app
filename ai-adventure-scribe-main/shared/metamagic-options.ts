/**
 * Metamagic (#1233): the eight option ids a Sorcerer can know, and the 2014 rule for how many.
 * The server validates a stored list against this; the client reads the same names for display.
 * Point costs live in limited-feature-counts.ts (METAMAGIC_COSTS); Twinned costs the spell level.
 */
export const METAMAGIC_OPTION_IDS = [
  'careful',
  'distant',
  'empowered',
  'extended',
  'heightened',
  'quickened',
  'subtle',
  'twinned',
] as const;

export type MetamagicOptionId = (typeof METAMAGIC_OPTION_IDS)[number];

export const isMetamagicOptionId = (value: unknown): value is MetamagicOptionId =>
  typeof value === 'string' && (METAMAGIC_OPTION_IDS as readonly string[]).includes(value);

/**
 * How many Metamagic options a Sorcerer of this class level knows (PHB 2014, p.102): none below
 * 3rd, 2 at 3rd, 3 at 10th, 4 at 17th. Fail closed: a level below 3 knows none.
 */
export const metamagicOptionCap = (sorcererLevel: number): number => {
  if (sorcererLevel >= 17) return 4;
  if (sorcererLevel >= 10) return 3;
  if (sorcererLevel >= 3) return 2;
  return 0;
};

/**
 * Validates a stored option list against the ids and the cap. Returns the list in stored order,
 * or a reason. Used on write (the route refuses) and on read (the engine reads nothing it cannot
 * validate: see resource-ledger.ts).
 */
export const validateMetamagicOptionList = (
  list: unknown,
  sorcererLevel: number,
): { ok: true; options: MetamagicOptionId[] } | { ok: false; reason: string } => {
  if (!Array.isArray(list)) return { ok: false, reason: 'metamagicOptions must be a list' };
  const unknown = list.filter((option) => !isMetamagicOptionId(option));
  if (unknown.length) {
    return { ok: false, reason: `unknown Metamagic option: ${String(unknown[0])}` };
  }
  if (new Set(list).size !== list.length) {
    return { ok: false, reason: 'a Metamagic option is listed twice' };
  }
  const cap = metamagicOptionCap(sorcererLevel);
  if (list.length > cap) {
    return {
      ok: false,
      reason: `a Sorcerer of level ${sorcererLevel} knows at most ${cap} Metamagic option${cap === 1 ? '' : 's'}`,
    };
  }
  return { ok: true, options: list as MetamagicOptionId[] };
};
