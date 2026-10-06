import { describe, expect, it } from 'bun:test';

import { playerExitIntentBody } from '../../../../../../shared/test-fixtures/player-exit-intent';
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

/**
 * #2580: the player's own exits have to survive the route's own contract, in the exact body the
 * client sends. The union is the first thing a `flee` chip meets, and a schema that rejected the
 * player's way out of a fight would leave them where the issue found them: stuck, and told so.
 */
describe('the player exit intents (flee / yield)', () => {
  it.each(['flee', 'yield'] as const)('accepts the exact %s body the client posts', (type) => {
    expect(combatIntentRequestValidator.Check(playerExitIntentBody(type))).toBe(true);
  });

  it.each(['flee', 'yield'] as const)(
    'refuses %s without expectedVersion, like every versioned player intent',
    (type) => {
      const { expectedVersion: _omitted, ...intent } = playerExitIntentBody(type).intent;
      expect(
        combatIntentRequestValidator.Check({ ...playerExitIntentBody(type), intent }),
      ).toBe(false);
    },
  );

  it('accepts a DM-sourced flee without a version, as the DM dialect allows', () => {
    const body = playerExitIntentBody('flee');
    expect(
      combatIntentRequestValidator.Check({
        ...body,
        source: 'dm',
        intent: { type: 'flee', actorId: body.intent.actorId },
      }),
    ).toBe(true);
  });
});
