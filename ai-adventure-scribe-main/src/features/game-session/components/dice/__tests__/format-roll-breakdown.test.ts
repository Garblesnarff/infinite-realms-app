import { describe, expect, it } from 'vitest';

import { formatRollBreakdown } from '../format-roll-breakdown';

describe('formatRollBreakdown', () => {
  it('shows die + modifier = total for a 1d20+4 that landed 7', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 7 }],
        modifiers: 4,
        total: 11,
      }),
    ).toBe('7 + 4 = 11');
  });

  it('uses a minus sign for a negative modifier', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 9 }],
        modifiers: -2,
        total: 7,
      }),
    ).toBe('9 - 2 = 7');
  });

  it('keeps a subtracted dice group negative instead of folding it into the modifier', () => {
    expect(
      formatRollBreakdown({
        rolls: [
          { value: 8, sign: 1 },
          { value: 4, sign: 1 },
          { value: 2, sign: -1 },
        ],
        modifiers: 0,
        total: 10,
      }),
    ).toBe('8 + 4 - 2 = 10');
  });

  it('lists every face before the modifier', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 3 }, { value: 6 }],
        modifiers: 3,
        total: 12,
      }),
    ).toBe('3 + 6 + 3 = 12');
  });
});
