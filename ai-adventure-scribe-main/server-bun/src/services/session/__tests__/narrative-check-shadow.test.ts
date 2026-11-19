import { afterEach, describe, expect, test } from 'bun:test';

import { setRngSeed } from '../../../lib/rng.js';
import { narrativeCheckShadow } from '../narrative-check-outcome.js';

afterEach(() => setRngSeed(undefined));

describe('independent narrative-check shadow dice', () => {
  test('compares a natural face without changing the submitted value', () => {
    setRngSeed(1);
    expect(
      narrativeCheckShadow({
        text: 'Athletics: 17 (nat 12+5) success',
        request: { type: 'skill_check' },
      }),
    ).toEqual({ client: 12, server: 13, matches: false });
  });
  test('uses the total when the formatter omits a zero modifier', () => {
    setRngSeed(1);
    expect(
      narrativeCheckShadow({ text: 'Athletics: 13 success', request: { type: 'check' } }),
    ).toEqual({ client: 13, server: 13, matches: true });
  });
  test('rolls both dice for advantage and disadvantage', () => {
    setRngSeed(1);
    expect(
      narrativeCheckShadow({ text: 'Athletics: 13 [ADV] success', request: { type: 'check' } })
        ?.server,
    ).toBe(13);
    setRngSeed(1);
    expect(
      narrativeCheckShadow({ text: 'Athletics: 13 [DIS] success', request: { type: 'check' } })
        ?.server,
    ).toBe(1);
  });
  test('does not compare saves or an invalid reported natural', () => {
    expect(narrativeCheckShadow({ text: 'Wisdom: 14', request: { type: 'save' } })).toBeNull();
    expect(
      narrativeCheckShadow({ text: 'Athletics: 25 (nat 21+4)', request: { type: 'check' } }),
    ).toBeNull();
  });
});
