import { describe, expect, test } from 'bun:test';

import {
  VOICE_CATEGORY_VALUES,
  dmResponseSchema,
  parseDmResponse,
  reviewNarrationSpeakerSplit,
} from '../dm-response-schema.js';

const response = (overrides: Record<string, unknown> = {}) => ({
  text: 'The lantern flame gutters in the cold passage.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  ...overrides,
});

describe('dmResponseSchema options contract', () => {
  test('requires an array of strings in the provider schema', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.options).toEqual({ type: 'array', items: { type: 'string' } });
    expect(dmResponseSchema.required).toContain('options');
  });

  test('parses and preserves structured action options', () => {
    const options = [
      'A. **Study the passage**, look for signs of movement.',
      'B. **Call out**, see whether anyone answers.',
      'C. **Press onward**, keep your hand near your weapon.',
    ];

    const parsed = parseDmResponse(response({ options }));

    expect(parsed).toEqual({ success: true, data: expect.objectContaining({ options }) });
  });

  test('rejects an options value containing non-string items', () => {
    const parsed = parseDmResponse(response({ options: ['A. **Look**, inspect the passage.', 2] }));

    expect(parsed).toEqual({
      success: false,
      issues: ['options must be an array of strings'],
    });
  });

  test('accepts legacy local shells that omit options', () => {
    expect(parseDmResponse(response()).success).toBe(true);
  });
});

describe('dmResponseSchema voice category contract', () => {
  test('exposes the closed configured voice category enum', () => {
    const properties = dmResponseSchema.properties as Record<string, unknown>;
    const narrationSegmentProperties = (
      properties.narration_segments as {
        items: { properties: { voice_category: unknown } };
      }
    ).items.properties;

    expect(narrationSegmentProperties.voice_category).toEqual({
      anyOf: [{ type: 'string', enum: [...VOICE_CATEGORY_VALUES] }, { type: 'null' }],
    });
  });

  test('normalizes reopen free-text labels to configured keys', () => {
    const parsed = parseDmResponse(
      response({
        narration_segments: [
          {
            type: 'character',
            text: 'P-please...',
            character: 'Professor Emil Darkwater',
            voice_category: 'high-pitched, fast, breathless',
          },
          {
            type: 'character',
            text: 'Sit.',
            character: 'Innkeep Mara',
            voice_category: 'calm',
          },
          {
            type: 'dm',
            text: 'The road is clear.',
            character: null,
            voice_category: 'narrative',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.narration_segments.map((segment) => segment.voice_category)).toEqual([
      'goblin',
      'innkeeper',
      'narrator',
    ]);
  });

  test('does not pass an unknown free-text category through', () => {
    const parsed = parseDmResponse(
      response({
        narration_segments: [
          {
            type: 'character',
            text: 'Who am I?',
            character: 'Mystery',
            voice_category: 'unmapped_style',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.narration_segments[0].voice_category).toBeNull();
  });
});

describe('dmResponseSchema speaker-split contract', () => {
  const mixedText = 'Captain Sarah Reeves steps onto the deck. "Hold the line," she says.';

  test('narration plus one NPC quote parses to at least two distinct speakers', () => {
    const parsed = parseDmResponse(
      response({
        text: mixedText,
        narration_segments: [
          {
            type: 'dm',
            text: 'Captain Sarah Reeves steps onto the deck.',
            character: null,
            voice_category: 'narrator',
          },
          {
            type: 'character',
            text: 'Hold the line.',
            character: 'Captain Sarah Reeves',
            voice_category: 'guard',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const review = reviewNarrationSpeakerSplit(parsed.data.text, parsed.data.narration_segments);
    expect(parsed.data.narration_segments.length).toBeGreaterThanOrEqual(2);
    expect(review.distinctSpeakers.length).toBeGreaterThanOrEqual(2);
    expect(review.flagged).toBe(false);
  });

  test('flags a mixed reply that collapsed into one speaker segment without failing parse', () => {
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const parsed = parseDmResponse(
        response({
          text: mixedText,
          narration_segments: [
            {
              type: 'dm',
              text: mixedText,
              character: null,
              voice_category: 'narrator',
            },
          ],
        }),
      );

      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const review = reviewNarrationSpeakerSplit(parsed.data.text, parsed.data.narration_segments);
      expect(review.flagged).toBe(true);
      expect(warnings.some((entry) => String(entry[0]).includes('collapsed mixed speakers'))).toBe(
        true,
      );
    } finally {
      console.warn = warn;
    }
  });
});
