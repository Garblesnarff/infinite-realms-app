import { describe, expect, it } from 'bun:test';

import {
  deathSaveIntentWire,
  deathSaveIntentWireAutoRolled,
} from '../../../../../../shared/test-fixtures/death-save-intent';
import {
  fighterFeatureChipIntentBody,
  fighterFeaturePlayerIntentBody,
} from '../../../../../../shared/test-fixtures/fighter-feature-intent';
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

describe("the popup's dropped die (#263 CB-028)", () => {
  const attack = {
    type: 'attack' as const,
    actorId: 'attacker-1',
    targetId: 'target-1',
    expectedVersion: 4,
  };

  it.each(['player', 'dm'] as const)(
    'accepts d20Rolls [kept, dropped] on an %s attack intent',
    (source) => {
      expect(
        combatIntentRequestValidator.Check({
          source,
          intent: { ...attack, d20: 8, d20Rolls: [8, 14] },
        }),
      ).toBe(true);
    },
  );

  it('accepts d20Rolls on a spell intent', () => {
    expect(
      combatIntentRequestValidator.Check({
        source: 'player',
        intent: { ...cantrip, d20: 8, d20Rolls: [8, 14] },
      }),
    ).toBe(true);
  });

  it.each([
    ['a single face', [8]],
    ['three faces', [8, 14, 3]],
    ['a face off the die', [8, 21]],
    ['a zero face', [0, 14]],
  ])('refuses d20Rolls with %s', (_label, d20Rolls) => {
    expect(
      combatIntentRequestValidator.Check({
        source: 'player',
        intent: { ...attack, d20: 8, d20Rolls },
      }),
    ).toBe(false);
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

  it.each(['player', 'dm'] as const)(
    'accepts the playerInput the client adds for a typed exit, as %s (#749)',
    (source) => {
      const body = playerExitIntentBody('flee');
      expect(
        combatIntentRequestValidator.Check({
          ...body,
          source,
          ...(source === 'dm' ? { intent: { type: 'flee', actorId: body.intent.actorId } } : {}),
          playerInput: 'I disengage and run for the door',
        }),
      ).toBe(true);
    },
  );

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

/**
 * #975: the Fighter's short-rest features ride the same contract as every other
 * intent, in the exact bodies the producers post (see the fixture header: the
 * clicked option posts the DM dialect, versionless; the player dialect is the
 * executor's other call shape). Each spends a tracked use on the sheet, so the
 * player dialect versions them like dash; a schema that rejected either body
 * would strand the declaration at "not supported yet" again.
 */
describe('the fighter feature intents (second_wind / action_surge)', () => {
  it.each(['second_wind', 'action_surge'] as const)(
    'accepts the exact %s body the clicked option posts',
    (type) => {
      expect(combatIntentRequestValidator.Check(fighterFeatureChipIntentBody(type))).toBe(true);
    },
  );

  it.each(['second_wind', 'action_surge'] as const)(
    'accepts the player-dialect %s body with its version',
    (type) => {
      expect(combatIntentRequestValidator.Check(fighterFeaturePlayerIntentBody(type))).toBe(true);
    },
  );

  it.each(['second_wind', 'action_surge'] as const)(
    'refuses a player-dialect %s without expectedVersion, like every versioned player intent',
    (type) => {
      const { expectedVersion: _omitted, ...intent } = fighterFeaturePlayerIntentBody(type).intent;
      expect(
        combatIntentRequestValidator.Check({ ...fighterFeaturePlayerIntentBody(type), intent }),
      ).toBe(false);
    },
  );
});
