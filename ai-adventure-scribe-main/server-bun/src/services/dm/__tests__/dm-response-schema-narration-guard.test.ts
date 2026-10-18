import { describe, expect, test } from 'bun:test';

import { rewriteNarrationSegmentsFromEnvelope } from '../dm-response-schema.js';

const originalText = '{"text":"The door holds.","narration_segments":[null]}';

describe('rewriteNarrationSegmentsFromEnvelope narration guard', () => {
  test('a null narration segment returns the original text', () => {
    const envelope = {
      text: 'The door holds.',
      narration_segments: [null],
      map_actions: [],
      handout_actions: [],
      combat_actions: [],
    };

    expect(rewriteNarrationSegmentsFromEnvelope(envelope, originalText)).toBe(originalText);
  });
});
