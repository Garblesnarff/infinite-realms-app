import { isRaging } from './combat-turn-flags.js';
import { rollD20 } from '../../lib/dice.js';

export async function rollCombatSavingThrow(
  encounterId: string,
  participantId: string,
  ability: string,
): Promise<number> {
  const strength = ability === 'str' || ability === 'strength';
  return rollD20(strength && (await isRaging(encounterId, participantId)));
}
