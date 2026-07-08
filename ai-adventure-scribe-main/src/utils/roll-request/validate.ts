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
    let beforeBlock = message.substring(0, rollBlockMatch.index);

    // A roll request means the outcome is unresolved. Drop any preceding sentence
    // that claims a hit, miss, success, failure, damage, or other resolved result.
    const outcomeSentence = /(?:^|(?<=[.!?])\s+)[^.!?]*(?:\b(?:hits?|miss(?:es|ed)?|succeeds?|fails?|critical hit|takes? \d+ (?:points? of )?damage)\b|\b(?:blade|arrow|spell|attack)\b[^.!?]*\b(?:cuts?|strikes?|connects?|lands?)\b)[^.!?]*[.!?]/i;
    const prematureOutcome = outcomeSentence.exec(beforeBlock);
    if (prematureOutcome?.index !== undefined) {
      beforeBlock = beforeBlock.substring(0, prematureOutcome.index).trim();
    }

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

  // Remove the ROLL_REQUESTS_V1 block (internal metadata, not for display)
  let result = message.replace(/```ROLL_REQUESTS_V1[\s\S]*?```/g, '');

  // Remove VISUAL PROMPT section (image-generation metadata, not player-facing)
  result = result.replace(/\*\*VISUAL PROMPT:\*\*[\s\S]*$/, '');
  result = result.replace(/^[\t ]*VISUAL\s+PROMPT:.*$/gim, '');

  // Strip A/B/C lettered action options — shown separately in the options panel, not in the bubble.
  // Handles both `A. **Action**` and `**A.** **Action**` formats.
  const optionLineIdx = result.search(/(?:^|\n)(?:\*\*)?[A-C]\.(?:\*\*)?\s/m);
  if (optionLineIdx !== -1) {
    result = result.substring(0, optionLineIdx);
  }

  // Strip ** bold markers — the custom renderer converts ** to * which causes orphan * artifacts
  // when smartSplitParagraph splits long bold spans at sentence boundaries.
  result = result.replace(/\*\*([^*\n]*)\*\*/g, '$1');

  // Strip leading/trailing --- separators (DM uses these to frame the narrative)
  result = result.replace(/^---\s*\n+/, '');
  result = result.replace(/\s*\n+\s*---\s*[\s\S]*$/, '');

  // Collapse runs of 3+ blank lines down to 2, then trim
  return result.replace(/\n{3,}/g, '\n\n').trim();
}
