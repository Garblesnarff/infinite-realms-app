import { describe, expect, it, vi } from 'vitest';

import { gameReducer, initialGameState } from '../game-reducer';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('gameReducer pending actions (#446)', () => {
  it('REMOVE_PENDING_ACTION removes only the named action', () => {
    let state = gameReducer(initialGameState, { type: 'ADD_PENDING_ACTION', payload: 'attack' });
    state = gameReducer(state, { type: 'ADD_PENDING_ACTION', payload: 'move' });

    state = gameReducer(state, { type: 'REMOVE_PENDING_ACTION', payload: 'attack' });

    expect(state.pendingActions).toEqual(['move']);
  });
});
