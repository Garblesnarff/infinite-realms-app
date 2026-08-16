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
  it('returns the same success boolean rendered by the transcript glyph', () => {
    const passed = check(18, 16);
    const failed = check(13, 15);

    expect(getDiceRollOutcome(passed)).toEqual({ success: true, target: 16, targetType: 'dc' });
    expect(formatDiceRoll(passed)).toContain('✓');

    expect(getDiceRollOutcome(failed)).toEqual({ success: false, target: 15, targetType: 'dc' });
    expect(formatDiceRoll(failed)).toContain('✗');
  });

  it('does not invent an outcome when no DC or attack AC exists', () => {
    const untargeted = { ...check(12, 10), dc: undefined };
    expect(getDiceRollOutcome(untargeted)).toBeUndefined();
  });
});
