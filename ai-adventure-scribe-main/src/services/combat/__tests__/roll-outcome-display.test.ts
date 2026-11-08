import { describe, expect, it, vi } from 'vitest';

import {
  engineRollOutcome,
  publishEngineRollOutcome,
  subscribeEngineRollOutcome,
} from '../roll-outcome-display';

describe('engine roll result display', () => {
  it('publishes the server attack result under the matching roll id', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEngineRollOutcome(listener);
    // Shape follows CombatAttackService.resolveSpellAttack's per-target result.
    publishEngineRollOutcome('spell-roll', {
      results: [
        {
          spellName: 'Fire Bolt',
          d20: 17,
          attackBonus: 5,
          totalAttackRoll: 22,
          targetAC: 17,
          hit: true,
          isCritical: false,
        },
      ],
    });
    expect(engineRollOutcome('spell-roll')).toEqual({
      rollId: 'spell-roll',
      kind: 'attack',
      d20: 17,
      bonus: 5,
      total: 22,
      hit: true,
      isCritical: false,
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
  it('does not invent an outcome from an incomplete or ambiguous engine response', () => {
    publishEngineRollOutcome('no-hit', { d20: 20, attackBonus: 5, totalAttackRoll: 25 });
    expect(engineRollOutcome('no-hit')).toBeUndefined();
    const target = { d20: 13, attackBonus: 5, totalAttackRoll: 18, hit: true };
    publishEngineRollOutcome('multiple', { results: [target, target] });
    expect(engineRollOutcome('multiple')).toBeUndefined();
    publishEngineRollOutcome('mixed', { results: [target, { hit: true }] });
    expect(engineRollOutcome('mixed')).toBeUndefined();
  });
  it('publishes the server check verdict and its actor die', () => {
    publishEngineRollOutcome('check-roll', {
      kind: 'shove',
      success: false,
      actorRoll: { d20: 11, modifier: 3, total: 14 },
      opposedBy: 15,
    });
    expect(engineRollOutcome('check-roll')).toEqual({
      rollId: 'check-roll',
      kind: 'check',
      d20: 11,
      bonus: 3,
      total: 14,
      success: false,
      isCritical: false,
    });
  });
});
