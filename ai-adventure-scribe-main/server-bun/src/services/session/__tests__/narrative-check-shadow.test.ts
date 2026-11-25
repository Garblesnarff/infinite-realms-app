import { describe, expect, test } from 'bun:test';
import pino from 'pino';

import {
  issuedCheckModifier,
  logNarrativeCheckShadowMismatch,
  narrativeCheckShadow,
  narrativeCheckShadowFacts,
} from '../narrative-check-outcome.js';

describe('narrative check shadow', () => {
  const request = { type: 'skill_check', formula: '1d20+5', dc: 15 };
  test('the mismatch line carries the client and server numbers, verdicts and ids', () => {
    const lines: string[] = [];
    const log = pino(
      {
        base: { service: 'infiniterealms-bun' },
        formatters: { level: (label) => ({ level: label }) },
      },
      { write: (line: string) => void lines.push(line) },
    );
    const facts = narrativeCheckShadowFacts({
      text: 'Athletics: 18 (nat 12+6) fail',
      request,
      modifier: 5,
    });
    logNarrativeCheckShadowMismatch(log, { sessionId: 'sess-1', rollRequestId: 'roll-1' }, facts!);
    expect(lines).toHaveLength(1);
    const row = JSON.parse(lines[0]!);
    expect(row).toMatchObject({
      level: 'info',
      service: 'infiniterealms-bun',
      msg: 'narrative check shadow mismatch',
      sessionId: 'sess-1',
      rollRequestId: 'roll-1',
      result: 'mismatch',
      clientTotal: 18,
      serverTotal: 17,
      natural: 12,
      modifier: 5,
      dc: 15,
      clientVerdict: 'fail',
      serverVerdict: 'success',
    });
    expect(Object.keys(row)).not.toContain('userId');
  });
  test('facts keep the same result as the narrower shadow', () => {
    expect(
      narrativeCheckShadowFacts({ text: 'Athletics: 18 (nat 12+6) fail', request, modifier: 5 }),
    ).toMatchObject({ result: 'mismatch', serverTotal: 17, serverVerdict: 'success' });
  });
  test('compares the reported natural with server modifier and verdict', () => {
    expect(
      narrativeCheckShadow({ text: 'Athletics: 17 (nat 12+5) success', request, modifier: 5 }),
    ).toEqual({ result: 'match' });
    expect(
      narrativeCheckShadow({ text: 'Athletics: 18 (nat 12+6) success', request, modifier: 5 }),
    ).toEqual({ result: 'mismatch' });
    expect(
      narrativeCheckShadow({ text: 'Athletics: 17 (nat 12+5) fail', request, modifier: 5 }),
    ).toEqual({ result: 'mismatch' });
  });
  test('does not infer a natural from the total', () => {
    expect(narrativeCheckShadow({ text: 'Athletics: 13 success', request, modifier: 0 })).toEqual({
      result: 'no_natural',
    });
  });
  test('checks kept natural for advantage and disadvantage', () => {
    for (const flag of ['ADV', 'DIS'])
      expect(
        narrativeCheckShadow({
          text: `Athletics: 17 (nat 12+5) [${flag}] success`,
          request,
          modifier: 5,
        }),
      ).toEqual({ result: 'match' });
  });
  test('uses two reported faces for advantage and disadvantage', () => {
    for (const [advantage, expected] of [
      [true, 17],
      [false, 6],
    ] as const) {
      expect(
        narrativeCheckShadow({
          text: `Athletics: ${expected} ${expected >= 15 ? 'success' : 'fail'}`,
          request,
          modifier: 5,
          context: { diceRoll: { results: [12, 1], advantage, disadvantage: !advantage } },
        }),
      ).toEqual({ result: 'match' });
    }
  });
  test('ignores saves and counts invalid reported natural as unavailable', () => {
    expect(
      narrativeCheckShadow({ text: 'Wisdom: 14', request: { type: 'save' }, modifier: 0 }),
    ).toBeNull();
    expect(
      narrativeCheckShadow({ text: 'Athletics: 25 (nat 21+4)', request, modifier: 4 }),
    ).toEqual({ result: 'no_natural' });
  });
  test('resolves numeric and character-backed symbolic server formulas', () => {
    expect(issuedCheckModifier(request, null)).toBe(5);
    expect(issuedCheckModifier({ formula: '1d20+STR' }, { stats: { strength: 16 } })).toBe(3);
    expect(issuedCheckModifier({ formula: '1d20+STR' }, null)).toBeNull();
  });
});
