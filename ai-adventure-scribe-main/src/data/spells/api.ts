import srdSpellsJson from '@/data/srd/spells.json';
import { logger } from '../../lib/logger';
import nonSrdSupplementJson from './non-srd-supplement.json';

import type { Spell } from '@/types/character';

type SrdSpell = Spell & { classes: string[]; legacy_ids?: string[] };
export const normalizeLegacySpellId = (id: string) => id.replace(
  /-(?:barbarian|bard|cleric|druid|fighter|monk|paladin|ranger|rogue|sorcerer|warlock|wizard)$/,
  '',
);
const sourceSpells = [...srdSpellsJson, ...nonSrdSupplementJson];

export const allSpells = sourceSpells.map((spell) => ({
  ...spell,
  castingTime: spell.casting_time,
  range: spell.range_text,
  verbal: spell.components_verbal,
  somatic: spell.components_somatic,
  material: spell.components_material,
  ...(spell.material_components ? { materialDescription: spell.material_components } : {}),
  duration: spell.concentration && !spell.duration.toLowerCase().includes('concentration')
    ? `Concentration, ${spell.duration}`
    : spell.duration,
})) as unknown as SrdSpell[];

export const getClassSpells = (className: string): { cantrips: Spell[]; spells: Spell[] } => {
  const normalizedClassName = className.charAt(0).toUpperCase() + className.slice(1).toLowerCase();
  const classKey = normalizedClassName.toLowerCase();
  const available = allSpells.filter((spell) => spell.classes.includes(classKey));

  // Debug logging for troubleshooting spell loading issues
  if (process.env.NODE_ENV === 'development') {
    logger.debug(
      `🔍 [getClassSpells] Looking up spells for: ${className} -> ${normalizedClassName}`,
    );
    logger.debug(`📋 [getClassSpells] SRD spells found:`, available.length);
  }

  if (!available.length) {
    if (process.env.NODE_ENV === 'development') {
      logger.warn(`⚠️ [getClassSpells] No mapping found for class: ${normalizedClassName}`);
    }
    return { cantrips: [], spells: [] };
  }

  const resultCantrips = available.filter((spell) => spell.level === 0);
  const resultSpells = available.filter((spell) => spell.level > 0);

  if (process.env.NODE_ENV === 'development') {
    logger.debug(`✅ [getClassSpells] ${normalizedClassName} results:`, {
      cantrips: resultCantrips.length,
      spells: resultSpells.length,
      totalAvailable: allSpells.length,
    });
  }

  return {
    cantrips: resultCantrips,
    spells: resultSpells,
  };
};

export const getSpellsBySchool = (school: string): Spell[] =>
  allSpells.filter((spell) => spell.school === school);
export const getSpellsByLevel = (level: number): Spell[] =>
  allSpells.filter((spell) => spell.level === level);
export const getRitualSpells = (): Spell[] => allSpells.filter((spell) => spell.ritual);
export const getConcentrationSpells = (): Spell[] =>
  allSpells.filter((spell) => spell.concentration);

export const searchSpells = (query: string): Spell[] => {
  const q = query.toLowerCase();
  return allSpells.filter(
    (spell) => spell.name.toLowerCase().includes(q) || spell.description.toLowerCase().includes(q),
  );
};

export const getSpellById = (id: string): Spell | undefined =>
  allSpells.find((spell) => {
    const normalizedId = normalizeLegacySpellId(id);
    return spell.id === normalizedId || spell.legacy_ids?.includes(id);
  });

export const validateSpellSelection = (
  className: string,
  selectedCantrips: string[],
  selectedSpells: string[],
): { valid: boolean; errors: string[] } => {
  const classSpells = getClassSpells(className);
  const errors: string[] = [];
  selectedCantrips.forEach((id) => {
    if (!classSpells.cantrips.some((c) => c.id === id))
      errors.push(`${id} is not available as a cantrip for ${className}`);
  });
  selectedSpells.forEach((id) => {
    if (!classSpells.spells.some((s) => s.id === id))
      errors.push(`${id} is not available as a spell for ${className}`);
  });
  return { valid: errors.length === 0, errors };
};
