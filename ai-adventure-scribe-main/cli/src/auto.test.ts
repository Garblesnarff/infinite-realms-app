import { describe, expect, it } from 'vitest';

import { runAutoTurns, selectAutoAction } from './auto';

describe('fixture auto play', () => {
  it('auto-resolves the full recorded roll batch before continuing', async () => {
    const pending: unknown[] = [{ purpose: 'Stealth' }, { purpose: 'Perception' }];
    const inputs: string[] = [];
    const batches: unknown[][] = [];
    let rollIndex = 0;
    const result = await runAutoTurns({
      get pendingRolls() { return pending.slice(rollIndex); },
      availableOptions: [],
      roll: () => ({ result: { total: [17, 12][rollIndex++] } }),
      play: async (input, rolls) => {
        inputs.push(input);
        batches.push([...(rolls || [])]);
        return [];
      },
    }, 1, () => undefined);

    expect(inputs).toEqual(['I completed all 2 pending rolls.']);
    expect(batches[0]).toHaveLength(2);
    expect(result).toMatchObject({
      turnsCompleted: 1,
      turnsFailed: 0,
      rollsMade: 2,
      contractViolations: 0,
      transportErrors: 0,
    });
  });

  it('selects real option text with persona bias and random default selection', () => {
    const options = [
      'Study the locked door for traps.',
      'Charge the armed guards and start a fight.',
      'Set the curtains on fire as a distraction.',
    ];
    expect(selectAutoAction(options, undefined, () => 0.5)).toBe(options[1]);
    expect(selectAutoAction(options, 'careful', () => 0)).toBe(options[0]);
    expect(selectAutoAction(options, 'aggressive', () => 0)).toBe(options[1]);
    expect(selectAutoAction(options, 'chaotic', () => 0)).toBe(options[2]);
    expect(selectAutoAction([], 'aggressive', () => 0)).toMatch(/confront|fight/i);
  });

  it('backs off twice at most, honors the retry hint, and reports serving providers', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const result = await runAutoTurns({
      pendingRolls: [],
      availableOptions: ['Open the door.'],
      roll: () => ({ result: { total: 1 } }),
      play: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('retry later'), { retryable: true, retryAfterMs: 3_000 });
        }
        return { provider: 'gemini', model: 'gemini-2.5-flash-lite' };
      },
    }, 1, () => undefined, { delayMs: 2_000, sleep: async (delay) => { delays.push(delay); } });

    expect(attempts).toBe(3);
    expect(delays).toEqual([3_000, 4_000]);
    expect(result.providerCounts).toEqual({ gemini: 1 });
    expect(result.providerModelCounts).toEqual({ 'gemini/gemini-2.5-flash-lite': 1 });
  });

  it('accounts honestly for clean, contract-failed, and transport-failed fixture turns', async () => {
    const failures = [
      null,
      { category: 'contract', message: 'missing text' },
      { category: 'transport', status: 502, message: 'upstream failed' },
    ];
    let turn = 0;
    const result = await runAutoTurns({
      pendingRolls: [],
      availableOptions: ['Continue.'],
      roll: () => ({ result: { total: 1 } }),
      play: async () => {
        const failure = failures[turn++];
        if (failure) throw failure;
        return {};
      },
    }, 3, () => undefined, { maxRetries: 0 });

    expect(result).toMatchObject({
      turnsCompleted: 1,
      turnsFailed: 2,
      contractViolations: 1,
      transportErrors: 1,
    });
  });
});
