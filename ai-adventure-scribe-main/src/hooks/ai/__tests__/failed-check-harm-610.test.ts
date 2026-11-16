import { beforeEach, describe, expect, it, vi } from 'vitest';

import { failedCheckHarmShadowPatterns, shadowFailedCheckHarm } from '../failed-check-harm-shadow';

import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-610') },
}));
vi.mock('@/services/client-failure-reporting', () => ({
  reportNarrationShadowHit: vi.fn(),
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

// Strategist FIX (#610): injury words about someone else, or not about a body, are not the hero's.
const NOT_THE_HERO = [
  'The merchant is dragged away.',
  'Blood stains the floor from an old battle.',
  'The bruised moon hangs over the ledge.',
  'His blood runs cold.',
  'The goblin bleeds.',
];

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
    vi.mocked(reportNarrationShadowHit).mockClear();
  });

  it('names the hero injury patterns (rope_burn, dragged) in the log and the report', async () => {
    await run();
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({
        reason: 'failed_check_harm_without_engine_damage',
        patterns: ['rope_burn', 'dragged'],
      }),
    );
    expect(reportNarrationShadowHit).toHaveBeenCalledWith(
      'failed_check_harm_without_engine',
      's-610',
      ['rope_burn', 'dragged'],
    );
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain('rope burns');
  });

  it.each([
    ['You are wounded.', 'wounded_injured'],
    ['You hit the hard, cold stone.', 'hit_hard_surface'],
  ])('names the hero in "%s" as %s', (text, name) => {
    expect(failedCheckHarmShadowPatterns(text)).toEqual([name]);
  });

  it.each(NOT_THE_HERO)('does not name "%s" (not the hero)', (text) => {
    expect(failedCheckHarmShadowPatterns(text)).toEqual([]);
  });

  it('does not log a negated injury ("no rope burns")', async () => {
    await run({ narration: { text: 'You slip, but there are no rope burns on your palms.' } });
    expect(shadowLogged()).toBe(false);
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

  it('fails open when the outcome lookup throws', async () => {
    await expect(
      run({ getOutcome: async () => Promise.reject(new Error('db down')) }),
    ).resolves.toBeUndefined();
    expect(shadowLogged()).toBe(false);
  });
});
