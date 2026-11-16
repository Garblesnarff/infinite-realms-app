/**
 * Always-prepared subclass spells, keyed by subclass name, then by the
 * class level at which they are gained (2014 SRD 5.1). One table: the
 * client subclass data and the server grant both read it.
 *
 * They are always prepared and do not count against the prepared limit.
 * An oath spell that is not on the paladin list is still a paladin spell.
 */
export const ALWAYS_PREPARED_SUBCLASS_SPELLS: Record<string, Record<number, string[]>> = {
  'Life Domain': {
    1: ['Bless', 'Cure Wounds'],
    3: ['Lesser Restoration', 'Spiritual Weapon'],
    5: ['Beacon of Hope', 'Revivify'],
    7: ['Death Ward', 'Guardian of Faith'],
    9: ['Mass Cure Wounds', 'Raise Dead'],
  },
  'Oath of Devotion': {
    3: ['Protection from Evil and Good', 'Sanctuary'],
    5: ['Lesser Restoration', 'Zone of Truth'],
    9: ['Beacon of Hope', 'Dispel Magic'],
    13: ['Freedom of Movement', 'Guardian of Faith'],
    17: ['Commune', 'Flame Strike'],
  },
};

/** Spell names the subclass has granted by this class level, in level order. */
export function alwaysPreparedSpellNames(subclassName: string, classLevel: number): string[] {
  const table = ALWAYS_PREPARED_SUBCLASS_SPELLS[subclassName];
  if (!table || classLevel < 1) return [];
  const names: string[] = [];
  for (const gainedAt of Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b)) {
    if (classLevel >= gainedAt) names.push(...(table[gainedAt] ?? []));
  }
  return names;
}
