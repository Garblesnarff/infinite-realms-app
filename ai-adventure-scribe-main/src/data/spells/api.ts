/*
 * SRD 5.1 attribution (Refs #985): This work includes material taken from the System
 * Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at
 * https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed
 * under the Creative Commons Attribution 4.0 International License available at
 * https://creativecommons.org/licenses/by/4.0/legalcode.
 */
import nonSrdSupplementJson from './non-srd-supplement.json';
import { logger } from '../../lib/logger';

import type { Spell } from '@/types/character';

import srdSpellsJson from '@/data/srd/spells.json';

type SrdSpell = Spell & { classes: string[]; legacy_ids?: string[] };
export const normalizeLegacySpellId = (id: string): string =>
  id.replace(
    /-(?:barbarian|bard|cleric|druid|fighter|monk|paladin|ranger|rogue|sorcerer|warlock|wizard)$/,
    '',
  );
const sourceSpells = [...srdSpellsJson, ...nonSrdSupplementJson];

const normalizeSpells = (spells: readonly unknown[]): SrdSpell[] =>
  spells.map((rawSpell) => {
    const spell = rawSpell as SrdSpell;
    return {
      ...spell,
      duration:
        spell.concentration && !spell.duration.toLowerCase().includes('concentration')
          ? `Concentration, ${spell.duration}`
          : spell.duration,
    };
  });

export const allSpells = normalizeSpells(sourceSpells);
export const srdSpells = normalizeSpells(srdSpellsJson);

function getClassSpellsFromCatalog(
  className: string,
  catalog: readonly SrdSpell[],
): { cantrips: Spell[]; spells: Spell[] } {
  const normalizedClassName = className.charAt(0).toUpperCase() + className.slice(1).toLowerCase();
  const classKey = normalizedClassName.toLowerCase();
  const available = catalog.filter((spell) => spell.classes.includes(classKey));

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
      totalAvailable: catalog.length,
    });
  }

  return {
    cantrips: resultCantrips,
    spells: resultSpells,
  };
}

export const getClassSpells = (className: string): { cantrips: Spell[]; spells: Spell[] } => {
  return getClassSpellsFromCatalog(className, allSpells);
};

/** Return only the 2014 SRD spell list for deterministic default loadouts. */
export const getSrdClassSpells = (className: string): { cantrips: Spell[]; spells: Spell[] } =>
  getClassSpellsFromCatalog(className, srdSpells);

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
