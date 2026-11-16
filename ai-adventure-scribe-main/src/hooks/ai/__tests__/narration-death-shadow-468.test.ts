import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playerDeathShadowPatterns } from '../../../../shared/narration-harm';
import { PLAYER_DEATH_SHADOW_REASON, enforceNarrationGate } from '../narration-gate';

import logger from '@/lib/logger';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-468') },
  isRollOutcomeStale: () => false,
}));
vi.mock('@/services/client-failure-reporting', () => ({
  reportNarrationShadowHit: vi.fn(),
}));

// #468 shadow: the gate counts unlisted player-death phrasings by pattern name and never rejects.
const UNLISTED_DEATHS: Array<[string, string]> = [
  ['You strike the rocks and die.', 'you_die'],
  ['You plunge into the dark and die on the rocks below.', 'you_die'],
  ['You perish on the rocks below.', 'you_die'],
  ['You breathe your last on the stones below.', 'breathe_last'],
  ['You are slain by the fall.', 'you_killed'],
  ['Your life ends in the chasm.', 'life_ends'],
  ['You fall to your doom.', 'fall_to_doom'],
];

// Negative cases from the #468 strategist FIX: an NPC's act, a hypothetical, a perception or a
// threat is not the hero's death.
const NOT_A_DEATH = [
  'You watch him die.',
  'You could die here.',
  'you almost die.',
  'your torch dies.',
  'You see the sun die.',
  'you will die at dawn.',
  'The goblin dies at your feet.',
  'You would die if you jumped from here.',
  'The orc snarls, "I\'ll kill you!"',
  'You do not die today.',
  'You walk down the corridor.',
  'You hear the goblin die behind you.',
  'The rope is now too short for you to die.',
  'You would perish if you fell.',
  'You watch the torch die out.',
];

describe('#468 shadow: unlisted player-death phrasings', () => {
  beforeEach(() => {
    vi.mocked(logger.warn).mockClear();
    vi.mocked(reportNarrationShadowHit).mockClear();
  });

  it.each(UNLISTED_DEATHS)('names the pattern for "%s"', (text, name) => {
    expect(playerDeathShadowPatterns(text)).toEqual([name]);
  });

  it.each(NOT_A_DEATH)('does not report "%s"', (text) => {
    expect(playerDeathShadowPatterns(text)).toEqual([]);
  });

  it('logs names only (no matched text) and reports the hit with the names', async () => {
    const text = 'You strike the rocks and die.';
    const out = await enforceNarrationGate({
      narration: { text },
      sessionId: 'sess-468-fixture',
      branch: 'narrative',
      regenerate: vi.fn(),
    });
    expect(out.outcome).toBe('clean');
    expect(out.narration.text).toBe(text);
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_SHADOW',
      expect.objectContaining({ reason: PLAYER_DEATH_SHADOW_REASON, patterns: ['you_die'] }),
    );
    const logged = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(logged).not.toContain('strike the rocks');
    expect(reportNarrationShadowHit).toHaveBeenCalledWith(
      'narrated_death_without_engine',
      'sess-468-fixture',
      ['you_die'],
    );
  });

  it('a listed death is still rejected, not shadow-logged (#468 unchanged)', async () => {
    const regenerate = vi.fn().mockResolvedValue({ text: 'The chasm wind bites.' });
    const out = await enforceNarrationGate({
      narration: { text: 'Your journey through the chasm ends here...' },
      sessionId: 'sess-468',
      branch: 'narrative',
      regenerate,
    });
    expect(out.outcome).toBe('regenerated');
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_SHADOW', expect.anything());
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });
});
