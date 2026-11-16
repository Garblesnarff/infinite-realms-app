import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playerDeathShadowClaims } from '../../../../shared/narration-harm';
import { PLAYER_DEATH_SHADOW_REASON, enforceNarrationGate } from '../narration-gate';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-468') },
  isRollOutcomeStale: () => false,
}));

// #468 shadow: the gate logs death phrasings it does not list and never rejects them.
// Enforcement waits for the logged counts.
const UNLISTED_DEATHS = [
  'You strike the rocks and die.',
  'You plunge into the dark and die on the rocks below.',
  'You perish on the rocks below.',
  'You breathe your last on the stones below.',
  'You are slain by the fall.',
  'Your life ends in the chasm.',
  'You fall to your doom.',
];

describe('#468 shadow: unlisted player-death phrasings', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
  });

  it.each(UNLISTED_DEATHS)('reports "%s" as a shadow claim', (text) => {
    expect(playerDeathShadowClaims(text).length).toBeGreaterThan(0);
  });

  it.each([
    'The goblin dies at your feet.',
    'You would die if you jumped from here.',
    'The orc snarls, "I\'ll kill you!"',
    'You do not die today.',
    'You walk down the corridor.',
  ])('does not report "%s"', (text) => {
    expect(playerDeathShadowClaims(text)).toEqual([]);
  });

  it('logs an unlisted death in shadow and keeps the reply unchanged', async () => {
    const regenerate = vi.fn();
    const text = 'You strike the rocks and die.';
    const out = await enforceNarrationGate({
      narration: { text },
      sessionId: 's-468',
      branch: 'narrative',
      regenerate,
    });
    expect(out.outcome).toBe('clean');
    expect(out.narration.text).toBe(text);
    expect(regenerate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({ reason: PLAYER_DEATH_SHADOW_REASON, claims: expect.any(Array) }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
  });

  it('a listed death is still rejected, not shadow-logged (#468 unchanged)', async () => {
    const regenerate = vi.fn().mockResolvedValue({ text: 'The chasm wind bites.' });
    const out = await enforceNarrationGate({
      narration: { text: 'Your journey through the chasm ends here...' },
      sessionId: 's-468',
      branch: 'narrative',
      regenerate,
    });
    expect(out.outcome).toBe('regenerated');
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_SHADOW', expect.anything());
  });
});
