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
 * Returns the index of the last sentence-terminating character (.!?) in text,
 * where the punctuation is followed by whitespace or is at end-of-string.
 * Returns -1 if no boundary is found.
 */
export function findLastSentenceBoundary(text: string): number {
  const boundaryPattern = /[.!?](?=\s|$)/g;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = boundaryPattern.exec(text)) !== null) {
    lastIndex = match.index;
  }
  return lastIndex;
}

/**
 * CRITICAL: Truncates message at ROLL_REQUESTS_V1 block.
 * This prevents the AI's premature outcome narrative from being displayed.
 *
 * Use this BEFORE displaying/saving the message when roll requests are present.
 * The player should only see text BEFORE the roll request - the outcome comes
 * in a NEW response after the roll is completed.
 *
 * Truncation ends at the last complete sentence boundary (.!?) before the block.
 * Paragraph structure is preserved. Falls back to cleaned text if no boundary found.
 */
export function truncateAtRollRequest(message: string): string {
  if (!message) return message;

  // Find the ROLL_REQUESTS_V1 block
  const rollBlockMatch = message.match(/```ROLL_REQUESTS_V1[\s\S]*?```/);

  if (rollBlockMatch && rollBlockMatch.index !== undefined) {
    const beforeBlock = message.substring(0, rollBlockMatch.index);

    // Normalize whitespace within each paragraph while preserving paragraph breaks
    const normalized = beforeBlock
      .split(/\n{2,}/)
      .map((para) => para.replace(/\s+/g, ' ').trim())
      .filter((para) => para.length > 0)
      .join('\n\n');

    // Strip trailing incomplete-sentence punctuation and em-dashes
    const withoutTrailingJunk = normalized
      .replace(/[,;:]\s*$/, '')
      .replace(/—\s*$/, '')
      .trim();

    // Find the last complete sentence boundary
    const boundaryIdx = findLastSentenceBoundary(withoutTrailingJunk);

    if (boundaryIdx === -1) {
      // Fallback: no clean boundary found — return cleaned text as-is
      return withoutTrailingJunk;
    }

    return withoutTrailingJunk.substring(0, boundaryIdx + 1).trim();
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
