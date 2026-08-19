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
