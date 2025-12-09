/**
 * Roll Fallback System
 * Handles fallback roll requests when AI service is unavailable (e.g., payment required)
 * Extracted from ai-service.ts for modularity
 */

import type { RollRequest } from '@/components/game/DiceRollRequest';
import type { CombatDetectionResult } from '@/utils/combatDetection';

// Pattern to detect payment required errors
const PAYMENT_REQUIRED_PATTERN = /402|payment required/i;

/**
 * Extended roll request with skill/ability info for fallback generation
 */
export type FallbackRollRequest = RollRequest & {
  skill?: string;
  ability?: string;
};

/**
 * Mapping of action keywords to appropriate dice rolls
 * Used for fallback roll generation when AI is unavailable
 */
export const ROLL_KEYWORDS: Array<{
  keywords: string[];
  build: () => FallbackRollRequest;
}> = [
  // Combat - Attack rolls
  {
    keywords: ['attack', 'strike', 'swing', 'slash', 'stab', 'shoot', 'fire', 'charge', 'snipe', 'punch', 'kick', 'hit', 'fight'],
    build: () => ({
      type: 'attack',
      formula: '1d20+attack_bonus',
      purpose: 'Attack roll to resolve your strike',
      ac: 13,
    }),
  },
  // Stealth (DEX)
  {
    keywords: ['stealth', 'sneak', 'hide', 'creep', 'quietly', 'silently', 'slip past', 'avoid detection', 'stay hidden', 'move unseen', 'shadows', 'unnoticed'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Stealth check to stay hidden',
      dc: 14,
      skill: 'stealth',
      ability: 'dexterity',
    }),
  },
  // Deception (CHA)
  {
    keywords: ['deceive', 'lie', 'bluff', 'mislead', 'disguise', 'pretend', 'fake', 'trick', 'fool', 'con'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Deception check to mislead your target',
      dc: 15,
      skill: 'deception',
      ability: 'charisma',
    }),
  },
  // Persuasion (CHA)
  {
    keywords: ['persuade', 'convince', 'charm', 'negotiate', 'diplomacy', 'bargain', 'plead', 'appeal', 'sway', 'win over', 'reason with'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Persuasion check to influence the NPC',
      dc: 15,
      skill: 'persuasion',
      ability: 'charisma',
    }),
  },
  // Intimidation (CHA)
  {
    keywords: ['intimidate', 'threaten', 'menace', 'coerce', 'scare', 'frighten', 'bully', 'pressure', 'interrogate'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Intimidation check to cow your target',
      dc: 15,
      skill: 'intimidation',
      ability: 'charisma',
    }),
  },
  // Investigation (INT)
  {
    keywords: ['investigate', 'inspect', 'search', 'study', 'analyze', 'deduce', 'examine closely', 'find clues', 'look for'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Investigation check to uncover details',
      dc: 14,
      skill: 'investigation',
      ability: 'intelligence',
    }),
  },
  // Acrobatics (DEX)
  {
    keywords: ['acrobatic', 'flip', 'tumble', 'dodge', 'leap', 'balance', 'cartwheel', 'somersault', 'tight-rope', 'nimble'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Acrobatics check to keep your footing',
      dc: 13,
      skill: 'acrobatics',
      ability: 'dexterity',
    }),
  },
  // Athletics (STR)
  {
    keywords: ['climb', 'heave', 'lift', 'push', 'force', 'shove', 'grapple', 'swim', 'jump', 'sprint', 'wrestle', 'break down'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+strength_mod',
      purpose: 'Athletics check to power through the challenge',
      dc: 15,
      skill: 'athletics',
      ability: 'strength',
    }),
  },
  // Perception (WIS)
  {
    keywords: ['perceive', 'spot', 'notice', 'scan', 'watch', 'listen', 'hear', 'look around', 'keep an eye', 'on guard', 'aware'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Perception check to notice hidden details',
      dc: 13,
      skill: 'perception',
      ability: 'wisdom',
    }),
  },
  // Insight (WIS)
  {
    keywords: ['insight', 'sense motive', 'judge', 'read', 'tell if', 'detect lies', 'trustworthy', 'honest', 'true intentions'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Insight check to read intentions',
      dc: 13,
      skill: 'insight',
      ability: 'wisdom',
    }),
  },
  // Sleight of Hand (DEX)
  {
    keywords: ['pickpocket', 'palm', 'steal', 'swipe', 'pilfer', 'sleight of hand', 'conceal', 'plant'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Sleight of Hand check',
      dc: 14,
      skill: 'sleight_of_hand',
      ability: 'dexterity',
    }),
  },
  // Survival (WIS)
  {
    keywords: ['track', 'forage', 'survive', 'hunt', 'follow trail', 'navigate', 'find path', 'wilderness'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Survival check',
      dc: 13,
      skill: 'survival',
      ability: 'wisdom',
    }),
  },
  // Medicine (WIS)
  {
    keywords: ['heal', 'stabilize', 'treat wound', 'diagnose', 'first aid', 'medicine', 'bandage'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Medicine check',
      dc: 10,
      skill: 'medicine',
      ability: 'wisdom',
    }),
  },
  // Animal Handling (WIS)
  {
    keywords: ['calm animal', 'tame', 'ride', 'control mount', 'animal handling', 'soothe beast'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Animal Handling check',
      dc: 13,
      skill: 'animal_handling',
      ability: 'wisdom',
    }),
  },
  // Performance (CHA)
  {
    keywords: ['perform', 'sing', 'dance', 'act', 'play music', 'entertain', 'distract with'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Performance check',
      dc: 12,
      skill: 'performance',
      ability: 'charisma',
    }),
  },
  // Arcana (INT)
  {
    keywords: ['arcana', 'identify spell', 'magical knowledge', 'recognize magic', 'recall arcane'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Arcana check to recall magical knowledge',
      dc: 15,
      skill: 'arcana',
      ability: 'intelligence',
    }),
  },
  // History (INT)
  {
    keywords: ['history', 'recall', 'remember', 'know about', 'heard of', 'historical'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'History check to recall knowledge',
      dc: 13,
      skill: 'history',
      ability: 'intelligence',
    }),
  },
  // Nature (INT)
  {
    keywords: ['nature', 'identify plant', 'identify creature', 'natural knowledge', 'recognize beast'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Nature check',
      dc: 13,
      skill: 'nature',
      ability: 'intelligence',
    }),
  },
  // Religion (INT)
  {
    keywords: ['religion', 'divine knowledge', 'recognize deity', 'holy', 'unholy', 'undead lore'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Religion check',
      dc: 13,
      skill: 'religion',
      ability: 'intelligence',
    }),
  },
];

/**
 * Check if an error indicates payment is required (402 error)
 */
export function isPaymentRequiredError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (status === 402) {
    return true;
  }

  const message = (error as any)?.message ?? (error as any)?.response?.data?.error ?? '';
  return typeof message === 'string' && PAYMENT_REQUIRED_PATTERN.test(message);
}

/**
 * Determine appropriate fallback roll based on player text and combat context
 */
export function determineFallbackRoll(
  playerText: string,
  combatDetection: CombatDetectionResult,
): FallbackRollRequest | null {
  if (!playerText) {
    return combatDetection.isCombat
      ? {
          type: 'attack',
          formula: '1d20+attack_bonus',
          purpose: 'Attack roll as combat breaks out',
          ac: 13,
        }
      : null;
  }

  const lower = playerText.toLowerCase();
  for (const mapping of ROLL_KEYWORDS) {
    if (mapping.keywords.some((keyword) => lower.includes(keyword))) {
      return mapping.build();
    }
  }

  if (combatDetection.isCombat) {
    return {
      type: 'attack',
      formula: '1d20+attack_bonus',
      purpose: 'Attack roll to press the fight',
      ac: 13,
    };
  }

  return null;
}

/**
 * Format a roll request into a human-readable instruction
 */
export function formatRollInstruction(roll: FallbackRollRequest): string {
  const base = `Please roll ${roll.formula} for ${roll.purpose}`;
  const target = roll.dc ? ` (DC ${roll.dc})` : roll.ac ? ` (AC ${roll.ac})` : '';
  const adv = roll.advantage ? ' with advantage' : roll.disadvantage ? ' with disadvantage' : '';
  return `${base}${target}${adv}.`;
}

/**
 * Serialize a roll request for the ROLL_REQUESTS_V1 block
 */
export function serializeRollForBlock(roll: FallbackRollRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: roll.type,
    formula: roll.formula,
    purpose: roll.purpose,
  };

  if (roll.dc !== undefined) payload.dc = roll.dc;
  if (roll.ac !== undefined) payload.ac = roll.ac;
  if (roll.advantage !== undefined) payload.advantage = roll.advantage;
  if (roll.disadvantage !== undefined) payload.disadvantage = roll.disadvantage;
  if (roll.skill) payload.skill = roll.skill;
  if (roll.ability) payload.ability = roll.ability;

  return payload;
}

/**
 * Build a complete fallback response when payment is required
 * Generates contextual narrative and roll request based on player action
 */
export function buildPaymentRequiredFallback(
  playerText: string,
  combatDetection: CombatDetectionResult,
): {
  text: string;
  roll_requests: RollRequest[];
} {
  const roll = determineFallbackRoll(playerText, combatDetection);
  const narration = `The Dungeon Master pauses for a heartbeat, collecting their thoughts before continuing the scene.`;
  const tension = combatDetection.isCombat
    ? `Steel clashes in your imagination as the unresolved action hangs in the air.`
    : `The world around you seems to hold its breath, waiting for your next move.`;
  const rollLine = roll
    ? formatRollInstruction(roll)
    : `No roll is required yet—choose your approach.`;

  const options = [
    'A. **Stay the course**, following through exactly as you intended.',
    'B. **Adjust your tactics**, taking a more cautious, observant approach.',
    'C. **Try something unexpected**, improvising a bold alternative.',
  ];

  const rollsBlock = `\n\n\`\`\`ROLL_REQUESTS_V1\n${JSON.stringify({ rolls: roll ? [serializeRollForBlock(roll)] : [] }, null, 2)}\n\`\`\`\n`;

  const normalizedRoll: RollRequest | null = roll
    ? {
        type: roll.type,
        formula: roll.formula,
        purpose: roll.purpose,
        dc: roll.dc,
        ac: roll.ac,
        advantage: roll.advantage,
        disadvantage: roll.disadvantage,
      }
    : null;

  return {
    text: `${narration}\n\n${tension}\n${rollLine}\n\n${options.join('\n')}${rollsBlock}`,
    roll_requests: normalizedRoll ? [normalizedRoll] : [],
  };
}
