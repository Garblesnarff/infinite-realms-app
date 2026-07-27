import type { DiceRollRequest } from '@/utils/diceRolls';

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

  const { result, rollConfig, requestType, dc, ac } = roll;
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

  // Add success/failure indicator (DC/AC hidden from players, but AI DM still receives it)
  if (dc !== undefined) {
    formatted += total >= dc ? ' ✓' : ' ✗';
  } else if (ac !== undefined && requestType === 'attack') {
    formatted += total >= ac ? ' ✓' : ' ✗';
  }

  // Add critical indicators
  if (nat === 20 && requestType === 'attack') {
    formatted += ' CRITICAL HIT!';
  } else if (nat === 1 && requestType === 'attack') {
    formatted += ' Critical Miss';
  }

  return formatted;
}
