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
    expect(result).toEqual({
      turnsCompleted: 2,
      rollsMade: 1,
      contractViolations: 0,
      providerCounts: {},
      providerModelCounts: {},
    });
  });

  it('backs off twice at most, honors the retry hint, and reports serving providers', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await runAutoTurns({
      pendingRolls: [],
      roll: () => ({ result: { total: 1 } }),
      play: async () => {
        attempts += 1;
        if (attempts < 3) throw { retryable: true, retryAfterMs: 3_000 };
        return { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
      },
    }, 1, () => undefined, { delayMs: 2_000, sleep: async (delay) => { delays.push(delay); } });

    expect(attempts).toBe(3);
    expect(delays).toEqual([3_000, 4_000]);
    expect(result.providerCounts).toEqual({ gemini: 1 });
    expect(result.providerModelCounts).toEqual({ 'gemini/gemini-2.5-flash-lite': 1 });
  });
});
