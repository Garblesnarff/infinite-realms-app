import { describe, expect, it } from 'bun:test';

import { runAutoTurns } from './auto';

describe('fixture auto play', () => {
  it('auto-resolves a recorded roll gate before continuing', async () => {
    let pending: unknown[] = [{}];
    const inputs: string[] = [];
    const result = await runAutoTurns({
      get pendingRolls() { return pending; },
      roll: () => ({ result: { total: 17 } }),
      play: async (input) => { inputs.push(input); pending = []; return []; },
    }, 2, () => undefined);
    expect(inputs).toEqual(['I rolled 17.', 'I choose a careful, proactive course of action (2).']);
    expect(result).toEqual({ turnsCompleted: 2, rollsMade: 1, contractViolations: 0 });
  });
});
