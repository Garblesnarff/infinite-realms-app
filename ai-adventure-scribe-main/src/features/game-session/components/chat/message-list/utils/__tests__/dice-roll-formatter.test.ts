import { describe, expect, it } from 'vitest';

import { formatDiceRoll, getDiceRollOutcome } from '../dice-roll-formatter';

import type { DiceRollRequest } from '@/utils/diceRolls';

function check(total: number, dc: number): DiceRollRequest {
  return {
    id: 'roll-1',
    requestType: 'skill_check',
    description: 'Athletics Check',
    rollConfig: { dieType: 20, count: 1, modifier: 3 },
    timestamp: new Date('2026-08-15T00:00:00Z'),
    status: 'completed',
    dc,
    result: { total, naturalRoll: total - 3, results: [total - 3] },
  };
}

describe('dice roll outcome', () => {
  it('returns the same success boolean rendered by the transcript word', () => {
    const passed = check(18, 16);
    const failed = check(13, 15);

    expect(getDiceRollOutcome(passed)).toEqual({ success: true, target: 16, targetType: 'dc' });
    expect(formatDiceRoll(passed)).toContain('success');
    expect(formatDiceRoll(passed)).not.toMatch(/[✓✗]/);

    expect(getDiceRollOutcome(failed)).toEqual({ success: false, target: 15, targetType: 'dc' });
    expect(formatDiceRoll(failed)).toContain('fail');
    expect(formatDiceRoll(failed)).not.toMatch(/[✓✗]/);
  });

  it('labels an attack against AC as hit or miss, never a checkmark', () => {
    const miss: DiceRollRequest = {
      id: 'roll-2',
      requestType: 'attack',
      description: 'The Storyteller punches Dishwasher Prime',
      rollConfig: { dieType: 20, count: 1, modifier: -1 },
      timestamp: new Date('2026-08-15T00:00:00Z'),
      status: 'completed',
      ac: 10,
      result: { total: 9, naturalRoll: 10, results: [10] },
    };
    expect(getDiceRollOutcome(miss)).toEqual({ success: false, target: 10, targetType: 'ac' });
    expect(formatDiceRoll(miss)).toMatch(/miss$/);
    expect(formatDiceRoll(miss)).not.toMatch(/[✓✗]/);
  });

  it('does not invent an outcome when no DC or attack AC exists', () => {
    const untargeted = { ...check(12, 10), dc: undefined };
    expect(getDiceRollOutcome(untargeted)).toBeUndefined();
  });
});

describe('critical copy only on attack rolls (#2513)', () => {
  // Same DiceRollRequest shape as `check` above, which follows the queue's
  // producer: id, requestType, description, rollConfig, timestamp, status,
  // the dc/ac it carries, and the settled result in its full DiceRoll shape.
  const rollOf = (
    requestType: DiceRollRequest['requestType'],
    naturalRoll: number,
    modifier: number,
    target: { dc?: number; ac?: number },
  ): DiceRollRequest => ({
    id: 'roll-2513',
    requestType,
    description:
      requestType === 'attack'
        ? 'Longsword attack'
        : requestType === 'saving_throw'
          ? 'Wisdom saving throw'
          : 'Perception check',
    rollConfig: { dieType: 20, count: 1, modifier },
    timestamp: new Date('2026-08-15T00:00:00Z'),
    status: 'completed',
    ...target,
    // The settled result copies the DiceRoll producer's full output
    // (src/types/combat-participants.ts): every field it always sets.
    result: {
      dieType: 20,
      count: 1,
      modifier,
      results: [naturalRoll],
      keptResults: [naturalRoll],
      total: naturalRoll + modifier,
      naturalRoll,
      critical: naturalRoll === 20,
    },
  });

  it('keeps "Critical Miss" and the auto-miss word on a natural 1 attack', () => {
    const formatted = formatDiceRoll(rollOf('attack', 1, 3, { ac: 15 }));

    expect(formatted).toContain('miss');
    expect(formatted).toContain('Critical Miss');
  });

  it('shows no critical or hit/miss word on a natural 20 check', () => {
    const formatted = formatDiceRoll(rollOf('skill_check', 20, 3, { dc: 15 }));

    expect(formatted).toContain('success');
    expect(formatted).not.toContain('Critical');
    expect(formatted).not.toMatch(/\bhit\b|\bmiss\b/i);
  });

  it('shows no critical or hit/miss word on a natural 1 saving throw', () => {
    const formatted = formatDiceRoll(rollOf('saving_throw', 1, 2, { dc: 14 }));

    expect(formatted).toContain('fail');
    expect(formatted).not.toContain('Critical');
    expect(formatted).not.toMatch(/\bhit\b|\bmiss\b/i);
  });

  it('shows no critical word on a natural 20 saving throw', () => {
    const formatted = formatDiceRoll(rollOf('saving_throw', 20, 2, { dc: 14 }));

    expect(formatted).not.toContain('Critical');
    expect(formatted).not.toMatch(/\bhit\b|\bmiss\b/i);
  });
});
