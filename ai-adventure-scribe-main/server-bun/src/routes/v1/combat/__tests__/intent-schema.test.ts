import { describe, expect, it } from 'bun:test';

import { combatIntentRequestValidator } from '../intent-schema.js';

const cantrip = {
  type: 'spell' as const,
  actorId: 'caster-1',
  targetIds: ['target-1'],
  spellId: 'fire-bolt',
  spellName: 'Fire Bolt',
  expectedVersion: 4,
};

describe('combat spell intent schema', () => {
  it.each([
    ['explicit null', { slotLevel: null }],
    ['absent', {}],
  ])('accepts a cantrip with slotLevel %s', (_label, fields) => {
    expect(
      combatIntentRequestValidator.Check({
        source: 'player',
        intent: { ...cantrip, ...fields },
      }),
    ).toBe(true);
  });

  it('accepts the optional player d20 on a spell intent', () => {
    expect(
      combatIntentRequestValidator.Check({
        source: 'player',
        intent: { ...cantrip, d20: 17 },
      }),
    ).toBe(true);
  });
});
