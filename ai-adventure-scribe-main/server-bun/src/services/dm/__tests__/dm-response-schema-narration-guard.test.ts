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

describe('rewriteNarrationSegmentsFromEnvelope narration guard non-string character (#781)', () => {
  test('a non-string character returns the original text', () => {
    // #633: segment derivation reads `character.trim()` (derivation lines
    // ~80/~252), so a numeric character throws inside parseDmResponse and
    // the wrapper's try/catch must keep the original text — the reply is
    // already saved. The quoted line keeps the segment in the derivation
    // hints so the throw actually fires.
    const envelope = {
      text: 'The gardener says "Follow me." and turns away.',
      narration_segments: [
        { type: 'character', text: '"Follow me."', character: 123, voice_category: null },
      ],
      map_actions: [],
      handout_actions: [],
      combat_actions: [],
    };
    const original = JSON.stringify(envelope);

    expect(rewriteNarrationSegmentsFromEnvelope(envelope, original)).toBe(original);
  });
});

describe('rewriteNarrationSegmentsFromEnvelope options fail-closed (#864)', () => {
  const OPT_A = 'A. **Take the map**, and read it by the fire.';
  const OPT_B = 'B. **Ask about the heir**, pressing gently.';
  const OPT_C = 'C. **Leave quietly**, into the garden.';
  const DUPLICATED = [OPT_A, OPT_B, OPT_C, OPT_A, OPT_B, OPT_C];

  test('a valid envelope with duplicated options is deduped (success path)', () => {
    const envelope = {
      text: 'The gardener watches you, saying nothing.',
      options: DUPLICATED,
      map_actions: [],
      handout_actions: [],
      combat_actions: [],
    };
    const out = rewriteNarrationSegmentsFromEnvelope(envelope, JSON.stringify(envelope));
    expect(JSON.parse(out).options).toEqual([OPT_A, OPT_B, OPT_C]);
  });

  test('a failed parse still dedupes the options field instead of shipping it raw', () => {
    // An invalid combat action fails parseDmResponse, so the rewrite returns
    // the original text today — carrying the duplicated field with it. The
    // options field is well-formed on its own, so it must still be deduped.
    const envelope = {
      text: 'The gardener watches you, saying nothing.',
      options: DUPLICATED,
      map_actions: [],
      handout_actions: [],
      combat_actions: [{ action_type: 'attack' }],
    };
    const out = rewriteNarrationSegmentsFromEnvelope(envelope, JSON.stringify(envelope));
    expect(JSON.parse(out).options).toEqual([OPT_A, OPT_B, OPT_C]);
  });

  test('a failed parse still strips the in-text copy of the offered options', () => {
    const envelope = {
      text: [
        'The gardener watches you, saying nothing.',
        '',
        OPT_A,
        OPT_B,
        OPT_C,
      ].join('\n'),
      options: [OPT_A, OPT_B, OPT_C],
      map_actions: [],
      handout_actions: [],
      combat_actions: [{ action_type: 'attack' }],
    };
    const out = rewriteNarrationSegmentsFromEnvelope(envelope, JSON.stringify(envelope));
    const parsed = JSON.parse(out);
    expect(parsed.text).toBe('The gardener watches you, saying nothing.');
    expect(parsed.options).toEqual([OPT_A, OPT_B, OPT_C]);
  });

  test('a failed parse with a malformed options field still returns the original text', () => {
    // The fail-closed branch only fires for a well-formed string-array
    // options field; a malformed field was never deduped, so it stays
    // fail-open rather than shipping a re-serialized envelope.
    const envelope = {
      text: 'The gardener watches you, saying nothing.',
      options: [OPT_A, 123],
      map_actions: [],
      handout_actions: [],
      combat_actions: [{ action_type: 'attack' }],
    };
    const original = JSON.stringify(envelope);
    expect(rewriteNarrationSegmentsFromEnvelope(envelope, original)).toBe(original);
  });

  test('a failed parse with no options field still returns the original text', () => {
    const envelope = {
      text: 'The gardener watches you, saying nothing.',
      map_actions: [],
      handout_actions: [],
      combat_actions: [{ action_type: 'attack' }],
    };
    const original = JSON.stringify(envelope);
    expect(rewriteNarrationSegmentsFromEnvelope(envelope, original)).toBe(original);
  });
});
