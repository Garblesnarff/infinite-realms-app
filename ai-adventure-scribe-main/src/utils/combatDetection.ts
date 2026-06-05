/**
 * Combat Detection Utilities
 *
 * Analyzes DM responses and player actions to detect combat scenarios
 * and automatically initialize combat encounters
 */

import {
  type PlayerCharacterLike,
  createCombatParticipantsFromDetection,
} from './combat/participant-generation';

import { detectCombatActions, detectPlayerCombatAction } from '@/utils/combat/detection/actions';
import { COMBAT_KEYWORDS, ENEMY_TEMPLATES } from '@/utils/combat/detection/constants';
import {
  type CombatDetectionResult,
  type DetectedEnemy,
  type DetectedCombatAction,
} from '@/utils/combat/detection/types';
import { getDiceRollRequirements, shouldEndCombat } from '@/utils/combat/detection/utils';


export {
  type PlayerCharacterLike,
  createCombatParticipantsFromDetection,
  type CombatDetectionResult,
  type DetectedEnemy,
  type DetectedCombatAction,
  detectPlayerCombatAction,
  shouldEndCombat,
  getDiceRollRequirements,
};

/**
 * Detect combat scenarios from DM text
 */
export function detectCombatFromText(text: string, _context?: unknown): CombatDetectionResult {
  const lowerText = text.toLowerCase();
  let combatScore = 0;
  let combatType: CombatDetectionResult['combatType'] = 'none';
  const enemies: DetectedEnemy[] = [];
  let combatActions: DetectedCombatAction[] = [];
  let shouldStartCombat = false;
  let hasDirectCombatCue = false;
  let hasExplicitInitiative = false; // NEW: Track explicit initiative keywords separately
  let shouldEndCombatLocal = false;

  // Check for initiative keywords - ONLY these should trigger combat start
  if (COMBAT_KEYWORDS.initiative.some((keyword) => lowerText.includes(keyword))) {
    combatScore += 0.9;
    combatType = 'initiative';
    hasDirectCombatCue = true;
    hasExplicitInitiative = true; // Only set for initiative keywords
  }

  // Check for attack keywords
  if (COMBAT_KEYWORDS.attacks.some((keyword) => lowerText.includes(keyword))) {
    combatScore += 0.7;
    if (combatType === 'none') combatType = 'attack';
    hasDirectCombatCue = true;
  }

  // Check for spellcasting
  if (COMBAT_KEYWORDS.spellcasting.some((keyword) => lowerText.includes(keyword))) {
    combatScore += 0.6;
    if (combatType === 'none') combatType = 'spell_cast';
    hasDirectCombatCue = true;
  }

  // Check for damage
  if (COMBAT_KEYWORDS.damage.some((keyword) => lowerText.includes(keyword))) {
    combatScore += 0.5;
    if (combatType === 'none') combatType = 'damage_taken';
    hasDirectCombatCue = true;
  }

  // Check for enemies
  for (const enemy of COMBAT_KEYWORDS.enemies) {
    if (lowerText.includes(enemy)) {
      combatScore += 0.2; // Mentioning enemies alone shouldn't trigger combat

      // Extract enemy information
      const enemyType = enemy as keyof typeof ENEMY_TEMPLATES;
      const template = ENEMY_TEMPLATES[enemyType] || ENEMY_TEMPLATES.unknown;

      enemies.push({
        name: enemy.charAt(0).toUpperCase() + enemy.slice(1),
        type: enemyType,
        estimatedCR: template.cr,
        description: `A ${enemy} encountered in combat`,
        suggestedHP: template.hp,
        suggestedAC: template.ac,
      });
    }
  }

  // Check for combat ending
  if (COMBAT_KEYWORDS.endings.some((keyword) => lowerText.includes(keyword))) {
    combatScore += 0.3;
    shouldEndCombatLocal = true;
    shouldStartCombat = false;
  }

  // Detect combat actions in the text
  combatActions = detectCombatActions(text);
  if (combatActions.length > 0) {
    combatScore += 0.3 * combatActions.length;
    hasDirectCombatCue = true;
  }

  // Stealth/avoidance override: if text is clearly about stealth and no direct combat cue, don't start combat
  const stealthCues = [
    'stealth',
    'sneak',
    'hide',
    'hidden',
    'unseen',
    'shadows',
    'quietly',
    'listen',
    'avoid',
  ];
  const hasStealthCue = stealthCues.some((k) => lowerText.includes(k));
  if (hasStealthCue && !hasDirectCombatCue) {
    combatScore = Math.min(combatScore, 0.2);
  }

  // Final scoring
  const confidence = Math.min(combatScore, 1.0);
  const isCombat = confidence >= 0.5;

  // Decide if combat should start: ONLY on explicit initiative keywords
  // Attack/spell/damage keywords in narrative should NOT start combat
  // This prevents "Combat has begun" spam from DM describing actions
  shouldStartCombat = hasExplicitInitiative && isCombat;

  return {
    isCombat,
    combatType,
    confidence,
    enemies: enemies.length > 0 ? enemies : undefined,
    combatActions: combatActions.length > 0 ? combatActions : undefined,
    shouldStartCombat,
    shouldEndCombat: shouldEndCombatLocal,
  };
}
