import { parseRollRequests } from './parse';

import type { ParsedRollRequest } from './parse';

export function containsRollRequest(message: string): boolean {
  return parseRollRequests(message).length > 0;
}

export function detectsSuccessfulAttack(message: string): boolean {
  const hitPatterns = [
    /that\s+hits/gi,
    /you\s+hit/gi,
    /attack\s+hits/gi,
    /\d+\s+hits/gi,
    /successful\s+attack/gi,
    /your\s+(?:sword|weapon|blade|attack).*?(?:hits|strikes|connects)/gi,
    /critical\s+hit/gi,
    /natural\s+20/gi,
  ];
  return hitPatterns.some((pattern) => pattern.test(message));
}

export function detectsCriticalHit(message: string): boolean {
  const critPatterns = [/critical\s+hit/gi, /natural\s+20/gi, /nat\s+20/gi, /crit(?:ical)?/gi];
  return critPatterns.some((pattern) => pattern.test(message));
}

export function extractPrimaryRollRequest(message: string): ParsedRollRequest | null {
  const requests = parseRollRequests(message);
  return requests.length > 0 ? requests[0] : null;
}

/**
 * CRITICAL: Truncates message at ROLL_REQUESTS_V1 block.
 * This prevents the AI's premature outcome narrative from being displayed.
 *
 * Use this BEFORE displaying/saving the message when roll requests are present.
 * The player should only see text BEFORE the roll request - the outcome comes
 * in a NEW response after the roll is completed.
 */
export function truncateAtRollRequest(message: string): string {
  if (!message) return message;

  // Find the ROLL_REQUESTS_V1 block
  const rollBlockMatch = message.match(/```ROLL_REQUESTS_V1[\s\S]*?```/);

  if (rollBlockMatch && rollBlockMatch.index !== undefined) {
    // Keep only content BEFORE the roll request block
    let truncated = message.substring(0, rollBlockMatch.index).trim();

    // Clean up trailing punctuation and whitespace
    truncated = truncated
      .replace(/\s+/g, ' ')
      .replace(/[,;:]\s*$/, '')
      .trim();

    return truncated;
  }

  return message; // No roll block found - return as-is
}

/**
 * Removes roll requests from message for display.
 * Now uses truncation to prevent showing outcome after roll block.
 */
export function removeRollRequestsFromMessage(message: string): string {
  if (!message) return message;

  // Use truncation to remove everything at and after the roll request block
  // This prevents showing the outcome that the AI generated after the roll request
  return truncateAtRollRequest(message);
}
