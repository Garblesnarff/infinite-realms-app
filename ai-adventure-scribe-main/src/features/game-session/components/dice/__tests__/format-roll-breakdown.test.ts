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

  it('labels natural, modifier and total for a single d20', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 16, sign: 1, useInTotal: true }],
        modifiers: 6,
        total: 22,
        naturalRoll: 16,
      }),
    ).toBe('Natural 16 + Modifier +6 = Total 22');
  });

  it('subtracts a negative modifier instead of printing "+ -1"', () => {
    const text = formatRollBreakdown({
      rolls: [{ value: 9, sign: 1, useInTotal: true }],
      modifiers: -1,
      total: 8,
      naturalRoll: 9,
    });
    expect(text).toBe('Natural 9 \u2212 Modifier 1 = Total 8');
    expect(text).not.toContain('-1');
  });

  it('does not label a formula with another dice group (1d20+1d4+2)', () => {
    expect(
      formatRollBreakdown({
        rolls: [
          { value: 10, sign: 1, useInTotal: true },
          { value: 3, sign: 1, useInTotal: true },
        ],
        modifiers: 2,
        total: 15,
        naturalRoll: 10,
      }),
    ).toBe('10 + 3 + 2 = 15');
  });

  it('names the kept die and the dropped die on advantage', () => {
    expect(
      formatRollBreakdown({
        rolls: [
          { value: 10, sign: 1, useInTotal: false },
          { value: 15, sign: 1, useInTotal: true },
        ],
        modifiers: 1,
        total: 16,
        naturalRoll: 15,
        advantage: true,
      }),
    ).toBe('Natural 15 (kept, 10 dropped) + Modifier +1 = Total 16');
  });

  it('names the kept die and the dropped die on disadvantage', () => {
    expect(
      formatRollBreakdown({
        rolls: [
          { value: 15, sign: 1, useInTotal: false },
          { value: 10, sign: 1, useInTotal: true },
        ],
        modifiers: 1,
        total: 11,
        naturalRoll: 10,
        disadvantage: true,
      }),
    ).toBe('Natural 10 (kept, 15 dropped) + Modifier +1 = Total 11');
  });

  it('marks the kept die even when the roll carries only that die', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 15, sign: 1 }],
        modifiers: 1,
        total: 16,
        naturalRoll: 15,
        advantage: true,
      }),
    ).toBe('Natural 15 (kept) + Modifier +1 = Total 16');
  });

  it('names a tied dropped die: 12 kept and 12 dropped', () => {
    expect(
      formatRollBreakdown({
        rolls: [
          { value: 12, sign: 1, useInTotal: true },
          { value: 12, sign: 1, useInTotal: false },
        ],
        modifiers: 1,
        total: 13,
        naturalRoll: 12,
        advantage: true,
      }),
    ).toBe('Natural 12 (kept, 12 dropped) + Modifier +1 = Total 13');
  });

  it('prints a zero modifier as "+0"', () => {
    expect(
      formatRollBreakdown({
        rolls: [{ value: 16, sign: 1, useInTotal: true }],
        modifiers: 0,
        total: 16,
        naturalRoll: 16,
      }),
    ).toBe('Natural 16 + Modifier +0 = Total 16');
  });
});
