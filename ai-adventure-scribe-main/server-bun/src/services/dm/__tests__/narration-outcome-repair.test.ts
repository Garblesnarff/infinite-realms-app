import { describe, expect, test } from 'bun:test';

import {
  contradictsEngineOutcome,
  spliceContradictingSentences,
} from '../../../../../shared/narration-harm.js';
import { repairNarration } from '../narration-outcome.js';

// #266: the repair states the engine's authoritative outcome plainly — it replaces the false
// claim, it does not embroider it, and it never invents a consequence.
describe('repairNarration (#266)', () => {
  test('a failed check becomes a plain failure statement', () => {
    expect(
      repairNarration({
        success: false,
        total: 7,
        dc: 14,
        description: 'Stealth check to climb the shaft unheard',
      }),
    ).toBe('The Stealth check to climb the shaft unheard failed (7 vs DC 14).');
  });

  test('a successful attack narrated as a miss becomes a plain success statement', () => {
    expect(
      repairNarration({ success: true, total: 18, ac: 15, description: 'longsword attack' }),
    ).toBe('The longsword attack succeeded (18 vs AC 15).');
  });

  test('missing details degrade gracefully', () => {
    expect(repairNarration({ success: false, total: 7 })).toBe('The attempt failed (7).');
    expect(repairNarration({ success: true, total: 20 })).toBe('The attempt succeeded (20).');
  });
});

// The strategist FIX: only the contradicting sentences are replaced — the rest of the DM's
// reply is legitimate prose and stays.
describe('spliceContradictingSentences (#266)', () => {
  const failedStealth = {
    success: false,
    description: 'Stealth check to climb the shaft unheard',
    requestType: 'skill_check',
  };
  const truth = 'The Stealth check to climb the shaft unheard failed (7 vs DC 14).';

  const claimsFor = (text: string) => contradictsEngineOutcome(text, failedStealth);

  test('the contradicting sentence is replaced, the rest of the reply stands', () => {
    const text =
      'You take 2 damage scraping against the rough wall. ' +
      'You succeed in climbing the shaft unheard. ' +
      'Something below stirs at the noise.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(0);
    expect(spliceContradictingSentences(text, claims, truth)).toBe(
      'You take 2 damage scraping against the rough wall. ' +
        'The Stealth check to climb the shaft unheard failed (7 vs DC 14). ' +
        'Something below stirs at the noise.',
    );
  });

  test('a second contradicting sentence is removed, not repeated', () => {
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You manage to keep climbing the shaft in silence. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(1);
    expect(spliceContradictingSentences(text, claims, truth)).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a contradicting first sentence is replaced in place', () => {
    const text = 'You succeed without a sound. Loose stones clatter down the shaft.';
    const result = spliceContradictingSentences(text, claimsFor(text), truth);
    expect(result.startsWith(truth)).toBe(true);
    expect(result).toContain('Loose stones clatter down the shaft.');
  });

  test('no claims leaves the text untouched', () => {
    const text = 'You fail to keep quiet. Loose stones clatter down the shaft.';
    expect(spliceContradictingSentences(text, [], truth)).toBe(text);
  });

  test('an unknown claim leaves the text untouched', () => {
    const text = 'You fail to keep quiet. Loose stones clatter down the shaft.';
    expect(spliceContradictingSentences(text, [{ match: 'you succeed', index: 999 }], truth)).toBe(
      text,
    );
  });

  test('reversed-order claims splice in text order (strategist FIX)', () => {
    // "you succeed" comes before "you manage to" in the text, but the pattern order
    // lists "you manage to" first. Both sentences must go.
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You manage to keep climbing the shaft in silence. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    expect(claims.length).toBeGreaterThan(1);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a repeated phrase splices every occurrence (strategist FIX)', () => {
    const text =
      'You succeed in climbing the shaft unheard. ' +
      'You succeed in climbing the shaft unheard. ' +
      'The guards notice nothing.';
    const claims = claimsFor(text);
    // Two occurrences, two claims with different indices.
    expect(claims.length).toBe(2);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toBe(
      'The Stealth check to climb the shaft unheard failed (7 vs DC 14). The guards notice nothing.',
    );
  });

  test('a negated first occurrence does not hide a later real one (strategist FIX)', () => {
    // "You don't succeed" is negated (filtered); "You succeed" later is real.
    // The splicer must find the real one, not stop at the negated text.
    const text = "You don't succeed in climbing. You succeed in climbing the shaft unheard.";
    const claims = claimsFor(text);
    expect(claims.length).toBe(1);
    const result = spliceContradictingSentences(text, claims, truth);
    expect(result).toContain('The Stealth check to climb the shaft unheard failed (7 vs DC 14).');
  });
});
