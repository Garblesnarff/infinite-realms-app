/**
 * Bless's +1d4 (2014 5e, #902).
 *
 * While a caster concentrates on Bless, each blessed creature adds 1d4 to every attack roll
 * and saving throw it makes. The decision is pure so it can be unit-tested without a
 * database, the way hex-rider.ts keeps Hex's decision pure: combat-attack-service reads the
 * concentration rows and asks this module whether the participant making the roll is one of
 * the blessed.
 *
 * Who counts as blessed follows what the concentration row can actually say. A Bless cast
 * in combat stores its first target in `targetParticipantId`, so that participant is
 * blessed; a Bless whose row names no single target (the story and sheet-tag casts store
 * null) covers the caster themself — the reported case, "I cast Bless on myself". Anything
 * broader (a multi-target Bless tracked per creature) needs a bless-targets store the
 * schema does not have; see the #902 report.
 *
 * This module is deliberately database-free: combat-attack-service imports it at module
 * load, and pulling concentration-service (which reaches db/client) in here would break
 * the unit tests that mock the database-facing leaves.
 */

export const BLESS_SPELL_ID = 'bless';
export const BLESS_SPELL_NAME = 'Bless';

/** The shape this decision needs from a concentration row; ConcentrationState satisfies it. */
export interface BlessConcentration {
  characterId: string;
  spellName: string;
  spellId: string | null;
  targetParticipantId: string | null;
}

/** The participant making a roll: its encounter id and, for a PC, its character row id. */
export interface BlessParticipant {
  id: string;
  characterId?: string | null;
}

/** Whether a concentration row is a Bless at all (rows written before spell ids were stored match on the name). */
export function isBlessConcentration(
  concentration: BlessConcentration | null | undefined,
): concentration is BlessConcentration {
  if (!concentration) return false;
  return (
    concentration.spellId === BLESS_SPELL_ID ||
    concentration.spellName.trim().toLowerCase() === BLESS_SPELL_NAME.toLowerCase()
  );
}

/**
 * Whether this concentration row blesses this participant: the row's stored target is the
 * participant, or the row names no single target and the participant is the caster.
 */
export function appliesBlessDie(
  concentration: BlessConcentration | null | undefined,
  participant: BlessParticipant | null | undefined,
): boolean {
  if (!participant || !isBlessConcentration(concentration)) return false;
  if (concentration.targetParticipantId) {
    return concentration.targetParticipantId === participant.id;
  }
  return !!participant.characterId && concentration.characterId === participant.characterId;
}
