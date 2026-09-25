import type { ChatMessage } from '@/types/game';

/**
 * Out-of-combat check results are stored as the player's message so the
 * pending-roll fallback still sees them, but they are engine results. Combat
 * rolls already render as system lines; these should too.
 *
 * `formatDiceRoll` ends a DC check with "success" or "fail". Attack lines use
 * "hit" or "miss" and do not come through this bubble.
 */
export function isOutOfCombatCheckResult(message: ChatMessage): boolean {
  const requestType = message.context?.diceRoll?.requestType;
  if (message.context?.intent === 'dice_roll') {
    return requestType !== 'attack' && requestType !== 'initiative';
  }

  const text = (message.text ?? '').trim();
  return /:\s*\d+\s+(?:success|fail)\s*$/i.test(text);
}

/** Right-aligned player bubble. Check results stay on the engine side. */
export function isPlayerChatBubble(message: ChatMessage): boolean {
  return message.sender === 'player' && !isOutOfCombatCheckResult(message);
}
