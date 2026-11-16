import { beforeEach, describe, expect, it, vi } from 'vitest';

import { shadowFailedCheckHarm } from '../failed-check-harm-shadow';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-610') },
}));

// #610 (Hark N3-030): an Athletics check fails and the DM narrates injury (rope burns, dragged to
// the edge). The engine applies no damage and HP stays 12/12. Stubbed outcome, no provider.
const FAILED_ATHLETICS = {
  success: false,
  requestType: 'skill',
  description: 'Athletics check',
  timestamp: '2026-10-14T06:00:00Z',
} as never;
const HARM_REPLY =
  'Your grip slips and the rope burns across your palms. You are dragged to the edge of the ledge.';

const run = (over: Partial<Parameters<typeof shadowFailedCheckHarm>[0]> = {}) =>
  shadowFailedCheckHarm({
    narration: { text: HARM_REPLY },
    sessionId: 's-610',
    inCombat: false,
    conversationHistory: [],
    getOutcome: async () => FAILED_ATHLETICS,
    isStale: () => false,
    ...over,
  });

const shadowLogged = () =>
  vi.mocked(logger.warn).mock.calls.some(([msg]) => msg === 'DM_NARRATION_SHADOW');

describe('#610: failed check narrates harm with no engine damage', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it('logs the injury claim as a shadow with the failed-check reason', async () => {
    await run();
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({
        reason: 'failed_check_harm_without_engine_damage',
        claims: expect.arrayContaining(['rope burns', 'dragged']),
      }),
    );
  });

  it('does not log a successful check', async () => {
    await run({ getOutcome: async () => ({ ...FAILED_ATHLETICS, success: true }) });
    expect(shadowLogged()).toBe(false);
  });

  it('does not log in combat, where the engine resolves damage', async () => {
    await run({ inCombat: true });
    expect(shadowLogged()).toBe(false);
  });

  it('does not log when the engine applied declared story damage', async () => {
    await run({ declaredDamage: { amount: 4, source: 'fall' } });
    expect(shadowLogged()).toBe(false);
  });

  it('does not log a stale roll outcome', async () => {
    await run({ isStale: () => true });
    expect(shadowLogged()).toBe(false);
  });

  it('does not log a clean failed-check narration', async () => {
    await run({ narration: { text: 'The rope slips from your grip, and you catch the ledge.' } });
    expect(shadowLogged()).toBe(false);
  });

  it('does not log a negated injury ("no rope burns")', async () => {
    await run({ narration: { text: 'You slip, but there are no rope burns on your palms.' } });
    expect(shadowLogged()).toBe(false);
  });

  it('fails open when the outcome lookup throws', async () => {
    await expect(
      run({ getOutcome: async () => Promise.reject(new Error('db down')) }),
    ).resolves.toBeUndefined();
    expect(shadowLogged()).toBe(false);
  });
});
