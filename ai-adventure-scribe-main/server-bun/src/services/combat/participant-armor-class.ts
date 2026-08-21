/**
 * Participant armor class is a stored number or it is unset.
 *
 * AC 10 is a legal 5e value (unarmored, DEX 10). Treating it as "the column default,
 * look somewhere else" silently rewrote honest ACs to GENERIC_NPC_STATS (12) at
 * attack time — the collision #1871 names. Unset is NULL; never an in-band 10.
 */
import { GENERIC_NPC_STATS } from './srd-monster-resolution.js';
import { logger } from '../../lib/logger.js';

export type SeatArmorClassSources = {
  characterArmorClass?: number | null;
  npcArmorClass?: number | null;
  monsterArmorClass?: number | null;
};

/**
 * What to persist on the participant row at combat start.
 * NULL when no source supplied a number. Callers must not invent 10 here.
 */
export function seatParticipantArmorClass(sources: SeatArmorClassSources): number | null {
  const value = sources.characterArmorClass ?? sources.npcArmorClass ?? sources.monsterArmorClass;
  if (value == null) return null;
  return Number(value);
}

/**
 * Attack-time AC. A stored number, including 10, is the AC. NULL/undefined falls
 * through to GENERIC_NPC_STATS (12) and logs the same ungated fallback warning
 * #1864 made fire for name-only combatants.
 */
export function resolveParticipantArmorClass(
  participantArmorClass: number | null | undefined,
  context: Record<string, unknown> = {},
): number {
  if (participantArmorClass != null) return participantArmorClass;

  logger.warn({
    msg: 'Unset participant armor class at attack time; falling back to generic NPC stats',
    armorClass: GENERIC_NPC_STATS.armorClass,
    maxHp: GENERIC_NPC_STATS.maxHp,
    consequence: `combatant fights at generic NPC stats (AC ${GENERIC_NPC_STATS.armorClass}, ${GENERIC_NPC_STATS.maxHp} HP)`,
    ...context,
  });
  return GENERIC_NPC_STATS.armorClass;
}
