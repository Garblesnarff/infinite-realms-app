import { describe, expect, it } from 'bun:test';

import {
  deathSaveIntentWire,
  deathSaveIntentWireAutoRolled,
} from '../../../../../../shared/test-fixtures/death-save-intent';
import { playerExitIntentBody } from '../../../../../../shared/test-fixtures/player-exit-intent';
import { combatIntentRequestValidator, describeIntentRejection } from '../intent-schema.js';

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

describe('combat death save intent schema (#2518)', () => {
  it('accepts the exact body the client sends, with the die the player rolled', () => {
    expect(combatIntentRequestValidator.Check(deathSaveIntentWire('player-1', 14))).toBe(true);
  });

  it('accepts the auto-rolled body: no die, the engine rolls it', () => {
    expect(combatIntentRequestValidator.Check(deathSaveIntentWireAutoRolled('player-1'))).toBe(
      true,
    );
  });

  it('needs no expectedVersion: the save is not an optimistic-concurrency action', () => {
    // `end_turn` has none either; a player-dialect save must not be refused for lacking one.
    expect(
      combatIntentRequestValidator.Check({
        source: 'player',
        intent: { type: 'death_save', actorId: 'player-1', d20: 3 },
      }),
    ).toBe(true);
  });

  it.each([0, 21, 40])('refuses a die that is not a d20 face (%s)', (d20) => {
    const body = deathSaveIntentWire('player-1', d20);
    expect(combatIntentRequestValidator.Check(body)).toBe(false);
    expect(describeIntentRejection(body).variant).toBe('death_save');
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
      expect(combatIntentRequestValidator.Check({ ...playerExitIntentBody(type), intent })).toBe(
        false,
      );
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
