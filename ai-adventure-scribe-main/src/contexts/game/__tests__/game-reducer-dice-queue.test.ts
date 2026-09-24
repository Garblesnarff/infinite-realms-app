import { describe, expect, it, vi } from 'vitest';

import { gameReducer, initialGameState } from '../game-reducer';

import type { DiceRollRequest } from '@/types/combat';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function request(overrides: Partial<DiceRollRequest> & { id: string }): DiceRollRequest {
  return {
    requestType: 'skill_check',
    description: `Roll ${overrides.id}`,
    rollConfig: { dieType: 20, count: 1, modifier: 0 },
    timestamp: new Date(),
    status: 'pending',
    ...overrides,
  } as DiceRollRequest;
}

function add(state: typeof initialGameState, payload: DiceRollRequest): typeof initialGameState {
  return gameReducer(state, { type: 'ADD_DICE_ROLL_REQUEST', payload });
}

/**
 * #2190: only one queued request is visible at a time. The engine blocks on its own attack and
 * initiative prompts and auto-rolls them on a timer, so a narrative check holding the visible
 * slot throws the player's combat die away.
 */
describe('dice queue visibility ordering', () => {
  it('lets an engine initiative request take the slot from a narrative roll', () => {
    const withNarrative = add(initialGameState, request({ id: 'narrative-1' }));
    expect(withNarrative.diceRollQueue.currentRollId).toBe('narrative-1');

    const withEngine = add(
      withNarrative,
      request({
        id: 'engine-initiative',
        requestType: 'initiative',
        description: 'Initiative for The Veteran — 1d20+1',
        combatInitiativeRoll: true,
      }),
    );

    expect(withEngine.diceRollQueue.currentRollId).toBe('engine-initiative');
    // The displaced roll stays queued rather than being dropped.
    expect(withEngine.diceRollQueue.pendingRolls.map((roll) => roll.id)).toEqual([
      'narrative-1',
      'engine-initiative',
    ]);
  });

  it('lets an engine attack request take the slot from a narrative roll', () => {
    const withNarrative = add(initialGameState, request({ id: 'narrative-1' }));
    const withEngine = add(
      withNarrative,
      request({
        id: 'engine-attack',
        requestType: 'attack',
        description: 'Longsword attack vs Hulk — 1d20+5 vs AC 14',
        combatAttackRoll: true,
      }),
    );

    expect(withEngine.diceRollQueue.currentRollId).toBe('engine-attack');
  });

  it('keeps the first engine request visible when a second engine request arrives', () => {
    const withFirst = add(
      initialGameState,
      request({
        id: 'engine-initiative',
        requestType: 'initiative',
        description: 'Initiative for The Veteran — 1d20+1',
        combatInitiativeRoll: true,
      }),
    );
    const withSecond = add(
      withFirst,
      request({
        id: 'engine-attack',
        requestType: 'attack',
        description: 'Longsword attack vs Hulk — 1d20+5 vs AC 14',
        combatAttackRoll: true,
      }),
    );

    expect(withSecond.diceRollQueue.currentRollId).toBe('engine-initiative');
  });

  it('does not let a narrative roll take the slot from anything', () => {
    const withEngine = add(
      initialGameState,
      request({
        id: 'engine-initiative',
        requestType: 'initiative',
        description: 'Initiative for The Veteran — 1d20+1',
        combatInitiativeRoll: true,
      }),
    );
    const withNarrative = add(withEngine, request({ id: 'narrative-1' }));

    expect(withNarrative.diceRollQueue.currentRollId).toBe('engine-initiative');
  });

  it('does not treat an untagged attack request as an engine request', () => {
    // A raw DM `attack` roll_request carries no engine tag. It must not preempt anything.
    const withNarrative = add(initialGameState, request({ id: 'narrative-1' }));
    const withRawAttack = add(
      withNarrative,
      request({
        id: 'raw-dm-attack',
        requestType: 'attack',
        description: 'Longsword attack vs Chiropteran Hulk',
      }),
    );

    expect(withRawAttack.diceRollQueue.currentRollId).toBe('narrative-1');
  });
});
