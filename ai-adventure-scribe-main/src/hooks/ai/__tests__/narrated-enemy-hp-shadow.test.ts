import { afterEach, describe, expect, it, vi } from 'vitest';

import { narratedEnemyHpPatterns, shadowNarratedEnemyHp } from '../narrated-enemy-hp-shadow';

import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

vi.mock('@/services/client-failure-reporting', () => ({
  reportNarrationShadowHit: vi.fn(),
}));

describe('enemy HP narration shadow', () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    ['The ogre has 6 hit points left.', 'hp_left', 'You have 6 hit points left.'],
    ['The ogre is down to 6 HP.', 'down_to_hp', 'You are down to 6 HP.'],
    ['The ogre stands at 10/14 hp.', 'hp_fraction', 'Your HP is 10/14 HP.'],
    ['The ogre has 4 HP remaining.', 'hp_remaining', 'Esme has 4 HP remaining.'],
  ])('counts %s but skips its hero counterpart', (enemy, pattern, own) => {
    expect(narratedEnemyHpPatterns(enemy, 'Esme')).toEqual([pattern]);
    expect(narratedEnemyHpPatterns(own, 'Esme')).toEqual([]);
  });

  it.each([
    'The potion restores 4 hit points.',
    'The ogre takes 4 damage.',
    'The ogre is bloodied.',
    'The ogre is down to 6 arrows.',
    'The ogre has 6 HP.',
  ])('ignores %s', (text) => {
    shadowNarratedEnemyHp(text, 'session', 'Esme');
    expect(reportNarrationShadowHit).not.toHaveBeenCalled();
  });

  it('checks each sentence and reports once with unique pattern names', () => {
    shadowNarratedEnemyHp(
      'Esme (the Paladin) has 6 HP left. The ogre has 4 HP remaining. It has 4 HP remaining.',
      'session',
      'Esme (the Paladin)',
    );
    expect(reportNarrationShadowHit).toHaveBeenCalledTimes(1);
    expect(reportNarrationShadowHit).toHaveBeenCalledWith('narrated_enemy_hp_number', 'session', [
      'hp_remaining',
    ]);
  });

  it('swallows a telemetry failure', () => {
    vi.mocked(reportNarrationShadowHit).mockImplementationOnce(() => {
      throw new Error('telemetry unavailable');
    });
    expect(() => shadowNarratedEnemyHp('The ogre has 6 HP left.', 'session')).not.toThrow();
  });
});
