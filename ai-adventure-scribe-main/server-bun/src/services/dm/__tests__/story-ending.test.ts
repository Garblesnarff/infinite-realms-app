/**
 * #1020: the pure halves of story-ending.ts — the ending validator and the
 * ending-line text round-trip — run without a database, as story-damage's do.
 * The applier's database behavior is covered by
 * services/__tests__/story-ending.real-db.test.ts.
 */
import { describe, expect, test } from 'bun:test';

import {
  ENDING_LINE_PREFIX,
  MAX_ENDING_SUMMARY_LENGTH,
  endingLineText,
  summaryFromEndingLine,
  validCampaignEnding,
} from '../story-ending.js';

describe('validCampaignEnding', () => {
  test('accepts an object with a non-empty summary', () => {
    expect(validCampaignEnding({ summary: 'The Hollow closed over the Heartwood.' })).toBe(true);
  });

  test('rejects non-objects and missing or non-string summaries', () => {
    expect(validCampaignEnding(null)).toBe(false);
    expect(validCampaignEnding(undefined)).toBe(false);
    expect(validCampaignEnding('The end.')).toBe(false);
    expect(validCampaignEnding({})).toBe(false);
    expect(validCampaignEnding({ summary: 42 })).toBe(false);
    expect(validCampaignEnding({ summary: null })).toBe(false);
  });

  test('rejects empty and whitespace-only summaries', () => {
    expect(validCampaignEnding({ summary: '' })).toBe(false);
    expect(validCampaignEnding({ summary: '   ' })).toBe(false);
  });

  test('bounds the summary at the one-or-two-sentences contract', () => {
    expect(validCampaignEnding({ summary: 'x'.repeat(MAX_ENDING_SUMMARY_LENGTH) })).toBe(true);
    expect(validCampaignEnding({ summary: 'x'.repeat(MAX_ENDING_SUMMARY_LENGTH + 1) })).toBe(
      false,
    );
  });
});

describe('ending line text', () => {
  test('round-trips the summary through the engine line', () => {
    const summary = 'The party chose the Sunken Temple landing and the story ended.';
    expect(endingLineText(summary)).toBe(`${ENDING_LINE_PREFIX}${summary}`);
    expect(summaryFromEndingLine(endingLineText(summary))).toBe(summary);
  });

  test('reads no summary out of a foreign line', () => {
    expect(summaryFromEndingLine('⚙️ Engine: Story XP — +300 XP (Completed the one-shot).')).toBe(
      null,
    );
    expect(summaryFromEndingLine('The Hollow closed over the Heartwood.')).toBe(null);
    expect(summaryFromEndingLine(ENDING_LINE_PREFIX)).toBe(null);
  });
});
