import { describe, expect, test } from 'bun:test';

import { parseDmResponse } from '../dm-response-schema.js';
import {
  deriveNarrationSegments,
  normalizeNarrationWhitespace,
  withCoverageFallback,
} from '../narration-segment-derivation.js';

const envelope = (text: string, hints: unknown[] = []) => ({
  text,
  narration_segments: hints,
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
});

const concatEqualsSource = (text: string, segments: Array<{ text: string }>): void => {
  const withoutAssetsAndEngine = text
    .replace(/^[ \t]*⚙(?:️)?[ \t]*Engine:[^\r\n]*(?:\r?\n|$)/gim, '')
    .replace(/\[ASSET:[^\]]+\]/gi, '');
  expect(normalizeNarrationWhitespace(segments.map((segment) => segment.text).join(''))).toBe(
    normalizeNarrationWhitespace(withoutAssetsAndEngine),
  );
};

describe('deriveNarrationSegments', () => {
  test('prose + Reeves quote + prose + Professor quote becomes 4 segments in order', () => {
    const text =
      'Your fist lashes out across the chart table, maps fluttering. [ASSET:npc:captain-sarah-reeves] "Hold the line." The professor leans closer. [ASSET:npc:professor-emil-darkwater] "The descent is not merely a path, you see?"';
    const parsed = parseDmResponse(
      envelope(text, [
        {
          type: 'character',
          text: 'Hold the line.',
          character: 'Captain Sarah Reeves',
          voice_category: 'guard',
        },
        {
          type: 'character',
          text: 'The descent is not merely a path, you see?',
          character: 'Professor Emil Darkwater',
          voice_category: 'elder',
        },
      ]),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const segments = parsed.data.narration_segments;
    expect(segments).toHaveLength(4);
    expect(segments.map((segment) => segment.type)).toEqual(['dm', 'character', 'dm', 'character']);
    expect(segments[1]?.character).toBe('Captain Sarah Reeves');
    expect(segments[3]?.character).toBe('Professor Emil Darkwater');
    concatEqualsSource(text, segments);
  });

  test('drops a fabricated model hint that is not in the message text', () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const text = 'The captain nods. "Hold the line."';
      const segments = deriveNarrationSegments(text, [
        {
          type: 'character',
          text: 'Hold the line.',
          character: 'Captain Sarah Reeves',
          voice_category: 'guard',
        },
        {
          type: 'character',
          text: 'The descent is not merely a path, you see?',
          character: 'Professor Emil Darkwater',
          voice_category: 'elder',
        },
      ]);

      expect(warnings.some((entry) => String(entry[0]) === 'NARRATION_SEGMENT_NOT_IN_TEXT')).toBe(
        true,
      );
      expect(segments.some((segment) => segment.text.includes('descent'))).toBe(false);
      expect(segments.some((segment) => segment.character === 'Captain Sarah Reeves')).toBe(true);
    } finally {
      console.warn = warn;
    }
  });

  test('never voices the engine line', () => {
    const text =
      '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 — HIT.\n\nThe ward shatters. "Hold."';
    const parsed = parseDmResponse(
      envelope(text, [
        {
          type: 'character',
          text: 'Hold.',
          character: 'Captain Sarah Reeves',
          voice_category: 'guard',
        },
      ]),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const joined = parsed.data.narration_segments.map((segment) => segment.text).join('');
    expect(joined).not.toContain('Engine:');
    expect(joined).not.toContain('HIT');
    concatEqualsSource(text, parsed.data.narration_segments);
  });

  test('a reply with no quotes is a single narrator segment', () => {
    const text = 'The lantern flame gutters in the cold passage.';
    const parsed = parseDmResponse(envelope(text, []));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.narration_segments).toEqual([
      { type: 'dm', text, character: null, voice_category: 'narrator' },
    ]);
  });

  test('opening-turn single quotes attribute the Professor without splitting apostrophes', () => {
    const text =
      "The Professor's lantern doesn't flicker; you've seen this before. [ASSET:npc:professor-emil-darkwater] 'The readings are perfect, yes?' You don't step closer.";
    const parsed = parseDmResponse(
      envelope(text, [
        {
          type: 'character',
          text: 'The readings are perfect, yes?',
          character: 'Professor Emil Darkwater',
          voice_category: 'elder',
        },
      ]),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const segments = parsed.data.narration_segments;
    const professor = segments.find((segment) => segment.type === 'character');
    expect(professor?.character).toBe('Professor Emil Darkwater');
    expect(professor?.text).toContain('The readings are perfect, yes?');
    const prose = segments
      .filter((segment) => segment.type === 'dm')
      .map((segment) => segment.text)
      .join('');
    expect(prose).toContain("Professor's");
    expect(prose).toContain("doesn't");
    expect(prose).toContain("you've");
    expect(prose).toContain("don't");
    concatEqualsSource(text, segments);
  });

  test('coverage mismatch logs and falls back to one narrator segment', () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const text = 'The lantern gutters.';
      const result = withCoverageFallback(text, [
        { type: 'dm', text: 'unrelated', character: null, voice_category: 'narrator' },
      ]);
      expect(result).toEqual([{ type: 'dm', text, character: null, voice_category: 'narrator' }]);
      expect(
        warnings.some((entry) => String(entry[0]) === 'NARRATION_SEGMENTS_COVERAGE_MISMATCH'),
      ).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});
