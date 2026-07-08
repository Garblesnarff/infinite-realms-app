import { allSpells } from './spells/api';

export * from './spells/api';
export { spellSchools } from './spells/constants';
export type { SpellSchool } from './spells/constants';

export const cantrips = allSpells.filter((spell) => spell.level === 0);
export const firstLevelSpells = allSpells.filter((spell) => spell.level === 1);
