// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeAuthoritativeCombatIntent } from '../../src/services/combat/combat-action-executor';

vi.mock('@/services/auth/TokenService', () => ({ getAuthHeaders: () => ({}) }));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { reportClientFailure: vi.fn() } }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

describe('#934 engine rows without a browser', () => {
  it('returns authoritative engine rows to the CLI without dispatching a browser event', async () => {
    expect(typeof window).toBe('undefined');
    const result = {
      engineRows: [
        { id: 'engine-1', sessionId: 'session-1', text: 'The guard moves.', sequence: 3 },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result }), { status: 200 })),
    );
    await expect(
      executeAuthoritativeCombatIntent(
        'encounter-1',
        {
          type: 'dash',
          actorId: 'npc-1',
          expectedVersion: 1,
        },
        'dm',
      ),
    ).resolves.toEqual(result);
  });
});
