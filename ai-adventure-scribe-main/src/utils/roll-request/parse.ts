/**
 * Roll Request Parser (parse stage)
 * Parses DM messages to detect and extract dice roll requests.
 * Uses structured parsing for ROLL_REQUESTS_V1 blocks and regex for natural language fallback.
 */

import { normalizeFormula } from './formula-utils';
import { parseRegexRollRequests } from './regex-parser';

import type { ParsedRollRequest } from './regex-patterns';
import type { RollRequest } from '@/types/roll-request';

// Re-export for backward compatibility
export { normalizeFormula };
export type { ParsedRollRequest };

/** Structured code block pattern */
const CODE_BLOCK_PATTERN = /```ROLL_REQUESTS_V1\s*\n([\s\S]*?)\n```/gi;

/**
 * Parse a DM message for dice roll requests
 * Checks for structured blocks first, then falls back to regex-based natural language detection.
 */
export function parseRollRequests(message: string): ParsedRollRequest[] {
  const requests: ParsedRollRequest[] = [];

  // PRIORITY 1: Extract structured ROLL_REQUESTS_V1 code blocks
  let codeBlockMatch: RegExpExecArray | null;
  CODE_BLOCK_PATTERN.lastIndex = 0; // Reset stateful regex

  while ((codeBlockMatch = CODE_BLOCK_PATTERN.exec(message)) !== null) {
    try {
      const jsonContent = codeBlockMatch[1].trim();
      const parsed = JSON.parse(jsonContent);

      if (parsed.rolls && Array.isArray(parsed.rolls)) {
        parsed.rolls.forEach((roll: Record<string, unknown>) => {
          // Accept "purity" as a fallback for "purpose" (AI hallucination typo)
          const purposeValue = (roll.purpose ?? roll.purity) as string | undefined;
          if (roll.type && roll.formula && purposeValue) {
            requests.push({
              type: roll.type as RollRequest['type'],
              formula: roll.formula as string,
              purpose: purposeValue,
              dc: (roll.dc as number) ?? undefined,
              ac: (roll.ac as number) ?? undefined,
              advantage: (roll.advantage as boolean) ?? undefined,
              disadvantage: (roll.disadvantage as boolean) ?? undefined,
              // Additional fields for damage_taken type
              target: (roll.target as string) ?? undefined,
              damageType: (roll.damageType as string) ?? undefined,
              originalText: `ROLL_REQUESTS_V1: ${purposeValue}`,
              confidence: 1.0, // Structured data is highest confidence
            });
          }
        });
      }
    } catch (error) {
      console.warn('Failed to parse ROLL_REQUESTS_V1 code block:', error);
    }
  }

  // If we found structured rolls, return them immediately (no need for regex fallbacks)
  if (requests.length > 0) {
    return requests;
  }

  // PRIORITY 2: Fall back to regex pattern matching
  return parseRegexRollRequests(message);
}
