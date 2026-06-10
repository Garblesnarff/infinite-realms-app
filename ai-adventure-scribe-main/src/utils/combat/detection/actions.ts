import type { DetectedCombatAction } from '@/utils/combat/detection/types';

import { COMBAT_KEYWORDS } from '@/utils/combat/detection/constants';


/**
 * Detect specific combat actions that need dice rolls
 */
export function detectCombatActions(text: string): DetectedCombatAction[] {
  const actions: DetectedCombatAction[] = [];
  const sentences = text.split(/[.!?]+/);

  for (const sentence of sentences) {
    const lowerSentence = sentence.toLowerCase().trim();

    // Attack actions
    if (COMBAT_KEYWORDS.attacks.some((keyword) => lowerSentence.includes(keyword))) {
      const action = extractAction(sentence, 'attack');
      if (action) actions.push(action);
    }

    // Spell casting
    if (COMBAT_KEYWORDS.spellcasting.some((keyword) => lowerSentence.includes(keyword))) {
      const action = extractAction(sentence, 'spell');
      if (action) actions.push(action);
    }

    // Damage dealing
    if (COMBAT_KEYWORDS.damage.some((keyword) => lowerSentence.includes(keyword))) {
      const action = extractAction(sentence, 'damage');
      if (action) actions.push(action);
    }
  }

  return actions;
}

/**
 * Extract combat action details from a sentence
 */
export function extractAction(sentence: string, actionType: string): DetectedCombatAction | null {
  // Simple extraction - in a real implementation, this could use NLP
  const words = sentence.split(' ');
  let actor = 'Unknown';
  const target = '';
  let weapon = '';

  // Try to find actor (usually first entity mentioned)
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();
    if (COMBAT_KEYWORDS.enemies.includes(word)) {
      actor = word.charAt(0).toUpperCase() + word.slice(1);
      break;
    }
  }

  // Try to find weapon
  const weaponKeywords = ['sword', 'crossbow', 'bow', 'dagger', 'mace', 'weapon', 'claw', 'bite'];
  for (const weaponWord of weaponKeywords) {
    if (sentence.toLowerCase().includes(weaponWord)) {
      weapon = weaponWord;
      break;
    }
  }

  // Determine roll type
  let rollType: DetectedCombatAction['rollType'] = 'attack';
  let rollNeeded = true;

  if (actionType === 'spell') {
    rollType = 'save';
  } else if (actionType === 'damage') {
    rollType = 'damage';
    rollNeeded = false; // Damage might already be determined
  }

  return {
    actor,
    action: actionType,
    target,
    weapon,
    rollNeeded,
    rollType,
  };
}

/**
 * Detect player combat actions from player input
 */
export function detectPlayerCombatAction(playerInput: string): DetectedCombatAction | null {
  const lowerInput = playerInput.toLowerCase();

  // Defense actions - Check defense FIRST to avoid misclassifying "I dodge the attack"
  if (
    lowerInput.includes('dodge') ||
    lowerInput.includes('defend') ||
    lowerInput.includes('block')
  ) {
    return {
      actor: 'Player',
      action: 'defend',
      rollNeeded: false,
      rollType: 'skill',
    };
  }

  // Attack actions
  if (lowerInput.includes('attack') || lowerInput.includes('hit') || lowerInput.includes('shoot')) {
    return {
      actor: 'Player',
      action: 'attack',
      rollNeeded: true,
      rollType: 'attack',
    };
  }

  // Spell casting
  if (lowerInput.includes('cast') || lowerInput.includes('spell')) {
    return {
      actor: 'Player',
      action: 'cast spell',
      rollNeeded: true,
      rollType: 'attack',
    };
  }

  return null;
}
