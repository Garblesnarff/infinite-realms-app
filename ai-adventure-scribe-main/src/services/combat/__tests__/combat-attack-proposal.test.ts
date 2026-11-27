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

function sentRequestId(callIndex = 0): unknown {
  const calls = (globalThis.fetch as unknown as { mock: { calls: Array<[unknown, RequestInit]> } })
    .mock.calls;
  const headers = calls[callIndex]?.[1]?.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  // Case-insensitive: the server reads the header case-insensitively, so
  // the test must not pass while an `X-Request-Id` is actually sent.
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'x-request-id');
  return key === undefined ? undefined : headers[key];
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

  it('sends no idempotency key on an attack proposal (#1787, strategist FIX round 2)', async () => {
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
    expect(sentRequestId(0)).toBeUndefined();

    // A second proposal sends no key either — the server returns a
    // proposal before the dedup lookup, so a key would be ignored, not
    // honoured; the retry on a blip comes from the gate's propose
    // allowlist (rest-client.ts), not from a header.
    const proposal2 = await proposeAuthoritativeAttack('enc-1', {
      type: 'attack',
      actorId: 'pc-1',
      targetId: 'npc-1',
    });
    expect(proposal2).toMatchObject({ movementOnly: false });
    expect(sentRequestId(1)).toBeUndefined();
  });

  it('sends no idempotency key on a spell proposal (#1787, strategist FIX round 2)', async () => {
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
    expect(sentRequestId(0)).toBeUndefined();

    // A second proposal sends no key either — same reason as the attack
    // test: no header the server would ignore, retry via the allowlist.
    const proposal2 = await proposeAuthoritativeSpell('enc-1', {
      type: 'spell',
      actorId: 'pc-1',
      targetIds: ['npc-1'],
      spellName: 'Fireball',
    });
    expect(proposal2).toMatchObject({ spellId: 'fireball' });
    expect(sentRequestId(1)).toBeUndefined();
  });
});
