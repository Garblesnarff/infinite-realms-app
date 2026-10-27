import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({})),
}));

vi.mock('@/services/combat/combat-intent-failure', () => ({
  reportCombatIntentFailure: vi.fn(),
}));

import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';
import {
  endTurnUnlessAlreadyMoved,
  isTurnAlreadyMovedRefusal,
} from '@/services/combat/end-turn-already-moved';

describe('isTurnAlreadyMovedRefusal', () => {
  it('true for 422 naming another participant', () => {
    const err = new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
      currentParticipantId: 'goblin-1',
    });
    expect(isTurnAlreadyMovedRefusal(err, 'pc-1')).toBe(true);
  });

  it('false for same actor', () => {
    const err = new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
      currentParticipantId: 'pc-1',
    });
    expect(isTurnAlreadyMovedRefusal(err, 'pc-1')).toBe(false);
  });

  it('false for missing currentParticipantId', () => {
    const err = new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {});
    expect(isTurnAlreadyMovedRefusal(err, 'pc-1')).toBe(false);
  });

  it('false for status 404', () => {
    const err = new CombatIntentRefusedError('not found', 404, {
      currentParticipantId: 'goblin-1',
    });
    expect(isTurnAlreadyMovedRefusal(err, 'pc-1')).toBe(false);
  });

  it('false for non-CombatIntentRefusedError', () => {
    expect(isTurnAlreadyMovedRefusal(new Error('boom'), 'pc-1')).toBe(false);
  });
});

describe('endTurnUnlessAlreadyMoved', () => {
  const originalFetch = globalThis.fetch;
  const encounterId = 'encounter-1';
  const intent = { type: 'end_turn' as const, actorId: 'pc-1', actionId: 'action-1' };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('a. 422 naming another participant resolves to turnAlreadyEnded shape', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Actor is not the current-turn participant',
        details: { currentParticipantId: 'goblin-1' },
      }),
    })) as unknown as typeof fetch;
    const result = await endTurnUnlessAlreadyMoved(encounterId, intent, 'dm');
    expect(result).toEqual({ turnAlreadyEnded: true, currentParticipant: { id: 'goblin-1' } });
  });

  it('b. 422 naming the same actor rejects with CombatIntentRefusedError', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Actor is not the current-turn participant',
        details: { currentParticipantId: 'pc-1' },
      }),
    })) as unknown as typeof fetch;
    await expect(endTurnUnlessAlreadyMoved(encounterId, intent, 'dm')).rejects.toThrow(
      'Actor is not the current-turn participant',
    );
  });

  it('c. 500 { error: boom } rejects boom', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })) as unknown as typeof fetch;
    await expect(endTurnUnlessAlreadyMoved(encounterId, intent, 'dm')).rejects.toThrow('boom');
  });

  it('d. 200 result resolves unchanged', async () => {
    const resultPayload = { currentParticipant: { id: 'goblin-1', name: 'Goblin' } };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: resultPayload }),
    })) as unknown as typeof fetch;
    const result = await endTurnUnlessAlreadyMoved(encounterId, intent, 'dm');
    expect(result).toEqual(resultPayload);
  });
});
