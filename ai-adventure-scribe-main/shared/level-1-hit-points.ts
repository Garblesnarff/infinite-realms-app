/**
 * Level-1 max hit points, the one formula (#620).
 *
 * `character_stats.max_hit_points` at level 1 is derived, never sent: the
 * server computes it on create and on the stats upsert, and the character
 * creation preview shows it before save. This module is the single owner of
 * the rule — class hit die + CON modifier + Dwarven Toughness (+1 HP for a
 * Hill Dwarf) + Draconic Resilience (+1 HP for a Draconic Bloodline
 * sorcerer), minimum 1 — so the preview and the server cannot drift apart
 * the way the two client/server HP copies did before #620.
 *
 * Like `shared/armor-class.ts`, this module is dependency-free (it imports
 * only the other shared modules) and importable from the browser bundle and
 * the Bun server alike.
 */
import { abilityModifier } from './ability-modifier';
import { findSrdClass, type SrdClassData } from './srd-class-data';

/**
 * Subclasses the app stores as the character's class name (the same two the
 * spell-slot engine maps in THIRD_CASTER_SUBCLASSES); they use their parent's
 * hit die.
 */
const SUBCLASS_PARENT_CLASS: Record<string, string> = {
  'eldritch knight': 'Fighter',
  'arcane trickster': 'Rogue',
};

/** Resolve the SRD class for HP, following a known subclass to its parent. */
export function findSrdClassForHitPoints(
  className: string | null | undefined,
): SrdClassData | undefined {
  return (
    findSrdClass(className) ??
    findSrdClass(SUBCLASS_PARENT_CLASS[(className ?? '').trim().toLowerCase()] ?? '')
  );
}

/** Dwarven Toughness: +1 HP per level for a Hill Dwarf, matched on subrace name. */
export function dwarvenToughnessBonus(subrace: string | null | undefined): number {
  return /hill dwarf/i.test(subrace ?? '') ? 1 : 0;
}

/**
 * Draconic Resilience (Draconic Bloodline sorcerer): +1 HP per level. The
 * caller resolves the origin from the stored class-feature choices
 * (`isDraconicBloodline` in shared/class-feature-choices.ts); this helper is
 * level-1 only, so the per-level bonus is a flat +1.
 */
export function draconicResilienceHitPointBonus(draconicBloodline: boolean): number {
  return draconicBloodline ? 1 : 0;
}

/** The most common hit die, used when the class is legitimately absent. */
export const FALLBACK_HIT_DIE = 8;

/**
 * Level-1 max HP: class hit die + CON modifier + Dwarven Toughness, min 1.
 *
 * A non-empty class name that resolves to no SRD class (and no known
 * subclass) throws — bad data is loud. A missing class is valid input (the
 * create route leaves `class` optional; classless creates predate this rule),
 * so it falls back to a d8 instead of failing the create.
 */
export function computeLevel1MaxHitPoints(
  className: string | null | undefined,
  constitutionScore: number | null | undefined,
  subrace: string | null | undefined,
  options: { draconicBloodline?: boolean } = {},
): number {
  const classData = findSrdClassForHitPoints(className);
  if (!classData && (className ?? '').trim().length > 0) {
    throw new Error(
      `computeLevel1MaxHitPoints: unresolvable class "${className}"; expected an SRD class name`,
    );
  }
  const hitDie = classData?.hitDie ?? FALLBACK_HIT_DIE;
  // Draconic Resilience belongs to sorcerers only; the flag is ignored for
  // any other class so a stray choice string cannot inflate another class.
  const draconicBonus =
    classData?.name === 'Sorcerer'
      ? draconicResilienceHitPointBonus(options.draconicBloodline === true)
      : 0;
  return Math.max(
    1,
    hitDie +
      abilityModifier(constitutionScore ?? 10) +
      dwarvenToughnessBonus(subrace) +
      draconicBonus,
  );
}
