import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { proposeAuthoritativeAttack, proposeAuthoritativeSpell } from '../combat-attack-proposal';

const { mockReportClientFailure, mockToast } = vi.hoisted(() => ({
  mockReportClientFailure: vi.fn(),
  mockToast: vi.fn(),
}));

// Mock getAuthHeaders
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mockReportClientFailure },
}));

vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sentRequestId(callIndex = 0): unknown {
  const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, RequestInit]> } })
    .mock.calls;
  const headers = calls[callIndex]?.[1]?.headers as Record<string, string> | undefined;
  return headers?.['x-request-id'];
}

describe('combat-attack-proposal', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('mints a fresh idempotency key per attack proposal (#1787)', async () => {
    (globalThis.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ accepted: true, proposal: { movementOnly: false } }),
    });

    const proposal = await proposeAuthoritativeAttack('enc-1', {
      type: 'attack',
      actorId: 'pc-1',
      targetId: 'npc-1',
    });
    expect(proposal).toMatchObject({ movementOnly: false });
    expect(sentRequestId(0)).toMatch(UUID_PATTERN);

    // A second proposal mints a fresh key — a reused key would let the
    // server answer a new proposal with an old commit's stored response.
    const proposal2 = await proposeAuthoritativeAttack('enc-1', {
      type: 'attack',
      actorId: 'pc-1',
      targetId: 'npc-1',
    });
    expect(proposal2).toMatchObject({ movementOnly: false });
    expect(sentRequestId(1)).toMatch(UUID_PATTERN);
    expect(sentRequestId(1)).not.toBe(sentRequestId(0));
  });

  it('mints a fresh idempotency key per spell proposal (#1787)', async () => {
    (globalThis.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        proposal: {
          movementOnly: false,
          spellId: 'fireball',
          spellName: 'Fireball',
          kind: 'attack',
          attackBonus: 5,
          targetAc: 15,
          advantage: false,
          disadvantage: false,
        },
      }),
    });

    const proposal = await proposeAuthoritativeSpell('enc-1', {
      type: 'spell',
      actorId: 'pc-1',
      targetIds: ['npc-1'],
      spellName: 'Fireball',
    });
    expect(proposal).toMatchObject({ spellId: 'fireball' });
    expect(sentRequestId(0)).toMatch(UUID_PATTERN);

    // A second proposal mints a fresh key — same distinctness check as the
    // attack test, so a module-level constant cannot pass this test.
    const proposal2 = await proposeAuthoritativeSpell('enc-1', {
      type: 'spell',
      actorId: 'pc-1',
      targetIds: ['npc-1'],
      spellName: 'Fireball',
    });
    expect(proposal2).toMatchObject({ spellId: 'fireball' });
    expect(sentRequestId(1)).toMatch(UUID_PATTERN);
    expect(sentRequestId(1)).not.toBe(sentRequestId(0));
  });
});
