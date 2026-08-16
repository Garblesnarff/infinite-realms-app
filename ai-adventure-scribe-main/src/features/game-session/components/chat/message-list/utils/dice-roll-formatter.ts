import type { DiceRollRequest } from '@/utils/diceRolls';

export interface DiceRollOutcome {
  success: boolean;
  target: number;
  targetType: 'dc' | 'ac';
}

/** Derive the machine-readable outcome from the same target used by the UI. */
export function getDiceRollOutcome(roll: DiceRollRequest): DiceRollOutcome | undefined {
  if (!roll.result) return undefined;

  if (typeof roll.dc === 'number') {
    return {
      success: roll.result.total >= roll.dc,
      target: roll.dc,
      targetType: 'dc',
    };
  }

  if (typeof roll.ac === 'number' && roll.requestType === 'attack') {
    return {
      success: roll.result.total >= roll.ac,
      target: roll.ac,
      targetType: 'ac',
    };
  }

  return undefined;
}

/**
 * Format a single dice roll with enhanced context for both AI and human readability.
 * Returns formats like: "Stealth Check: 15 (nat 13+2) vs DC 13 ✓"
 *
 * @param roll The DiceRollRequest object containing roll details and result.
 * @returns A formatted string representation of the roll.
 */
export function formatDiceRoll(roll: DiceRollRequest): string {
  if (!roll.result) {
    return `${roll.description}: pending`;
  }

  const { result, rollConfig, requestType } = roll;
  const total = result.total;
  const nat = result.naturalRoll ?? total - rollConfig.modifier;
  const modifier = rollConfig.modifier;

  // Build base format: "Description: Total (nat Natural+Modifier)"
  let formatted = `${roll.description}: ${total}`;

  // Add natural roll and modifier breakdown if applicable
  if (modifier !== 0 || nat !== total) {
    formatted += ` (nat ${nat}`;
    if (modifier > 0) {
      formatted += `+${modifier}`;
    } else if (modifier < 0) {
      formatted += `${modifier}`;
    }
    formatted += ')';
  }

  // Add advantage/disadvantage notation
  if (rollConfig.advantage) {
    formatted += ' [ADV]';
  }
  if (rollConfig.disadvantage) {
    formatted += ' [DIS]';
  }

  // Render the same authoritative boolean that is persisted with the roll event.
  const outcome = getDiceRollOutcome(roll);
  if (outcome) {
    formatted += outcome.success ? ' ✓' : ' ✗';
  }

  // Add critical indicators
  if (nat === 20 && requestType === 'attack') {
    formatted += ' CRITICAL HIT!';
  } else if (nat === 1 && requestType === 'attack') {
    formatted += ' Critical Miss';
  }

  return formatted;
}
