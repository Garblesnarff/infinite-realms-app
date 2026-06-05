import type { DetectedCombatAction } from '@/utils/combat/detection/types';

import { COMBAT_KEYWORDS } from '@/utils/combat/detection/constants';


/**
 * Check if text indicates combat should end
 */
export function shouldEndCombat(text: string): boolean {
  const lowerText = text.toLowerCase();
  return COMBAT_KEYWORDS.endings.some((keyword) => lowerText.includes(keyword));
}

/**
 * Extract dice roll requirements from combat actions
 */
export function getDiceRollRequirements(actions: DetectedCombatAction[]): {
  attackRolls: number;
  damageRolls: number;
  savingThrows: number;
  skillChecks: number;
} {
  let attackRolls = 0;
  let damageRolls = 0;
  let savingThrows = 0;
  let skillChecks = 0;

  for (const action of actions) {
    if (!action.rollNeeded) continue;

    switch (action.rollType) {
      case 'attack':
        attackRolls++;
        if (action.action === 'attack') damageRolls++; // Attack rolls often need damage rolls
        break;
      case 'damage':
        damageRolls++;
        break;
      case 'save':
        savingThrows++;
        break;
      case 'skill':
        skillChecks++;
        break;
    }
  }

  return { attackRolls, damageRolls, savingThrows, skillChecks };
}
