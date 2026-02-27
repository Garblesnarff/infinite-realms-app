import type { CombatDetectionResult } from '@/utils/combatDetection';

/**
 * Build combat context if detected
 */
export function buildCombatContextPrompt(combatDetection: CombatDetectionResult): string {
  if (!combatDetection.isCombat) return '';

  let combatText = `\n\nCOMBAT CONTEXT DETECTED:
Combat Type: ${combatDetection.combatType}
Confidence: ${Math.round(combatDetection.confidence * 100)}%
Should Start Combat: ${combatDetection.shouldStartCombat ? 'YES' : 'NO'}
Should End Combat: ${combatDetection.shouldEndCombat ? 'YES' : 'NO'}`;

  // Add detected enemies
  if (combatDetection.enemies && combatDetection.enemies.length > 0) {
    combatText += `\n\nDETECTED ENEMIES:`;
    combatDetection.enemies.forEach((enemy) => {
      combatText += `\n- ${enemy.name} (${enemy.type}, CR ${enemy.estimatedCR})
  HP: ${enemy.suggestedHP}, AC: ${enemy.suggestedAC}
  Description: ${enemy.description}`;
    });
  }

  // Add detected combat actions
  if (combatDetection.combatActions && combatDetection.combatActions.length > 0) {
    combatText += `\n\nDETECTED COMBAT ACTIONS:`;
    combatDetection.combatActions.forEach((action) => {
      combatText += `\n- ${action.actor} performs ${action.action}${action.target ? ` against ${action.target}` : ''}${action.weapon ? ` with ${action.weapon}` : ''}
  Roll Type: ${action.rollType}, Needs Roll: ${action.rollNeeded ? 'YES' : 'NO'}`;
    });
  }

  combatText += `\n\n**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. Generate appropriate dice rolls for actions (attack rolls, damage rolls, saving throws)
2. Apply combat results immediately (reduce HP, apply conditions, etc.)
3. Describe combat actions cinematically but maintain mechanical accuracy
4. Show dice results: "The orc swings (rolls 16, hits AC 13) for 8 slashing damage"
5. Make tactical decisions for NPCs based on their intelligence and experience
6. Consider environmental factors and positioning
7. Narrate the consequences of each action dramatically`;

  return combatText;
}
