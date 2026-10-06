import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { TacticalMap } from '../../../tactical/types.js';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

/**
 * A participant as `CombatEncounterService.getCombatState` returns it: the row, its `status`, and
 * its `conditions` joined with the library row (`condition.name`). A condition written by a
 * mid-combat check carries `sourceDescription` `combat_check` (Prone) or
 * `combat_check:grappler:<id>` (Grappled), exactly what `combat-check-service` writes.
 */
type Cond = {
  id: string;
  isActive: boolean;
  sourceDescription: string | null;
  condition: { name: string };
};
type Seat = {
  id: string;
  name: string;
  participantType: string;
  isActive: boolean;
  status: { currentHp: number };
  conditions: Cond[];
};

const seat = (id: string, name: string, type: string, conditions: Cond[] = []): Seat => ({
  id,
  name,
  participantType: type,
  isActive: true,
  status: { currentHp: 10 },
  conditions,
});
const cond = (id: string, name: string, sourceDescription: string | null): Cond => ({
  id,
  isActive: true,
  sourceDescription,
  condition: { name },
});

let participants: Seat[] = [];
let entities: Array<{ id: string; x: number; y: number }> = [];
const removed: string[] = [];
const advanced: Array<{ encounterId: string; round: number }> = [];
const facts: string[] = [];

mock.module('../../conditions-service.js', () => ({
  ConditionsService: {
    advanceConditionDurations: async (encounterId: string, round: number) => {
      advanced.push({ encounterId, round });
      return { expiredConditions: [], savingThrowsNeeded: [] };
    },
    removeCondition: async (conditionId: string) => {
      removed.push(conditionId);
      return true;
    },
  },
}));
mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: { getCombatState: async () => ({ participants }) },
}));
mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () =>
    ({
      entities: entities.map((entity) => ({ ...entity, size: 'medium', type: 'monster' })),
    }) as unknown as TacticalMap,
}));
mock.module('../tactical-action-service.js', () => ({
  recordDmTacticalFact: async (_sessionId: string, fact: string) => {
    facts.push(fact);
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { settleCheckConditionsForTurn } = await import('../combat-check-conditions.js');

const settle = (startingParticipantId: string, newRound = false, roundNumber = 2) =>
  settleCheckConditionsForTurn({
    encounterId: 'encounter-1',
    sessionId: 'session-1',
    startingParticipantId,
    roundNumber,
    newRound,
  });

beforeEach(() => {
  participants = [];
  entities = [];
  removed.length = 0;
  advanced.length = 0;
  facts.length = 0;
});

describe('Prone ends when the creature stands (SRD 5.1)', () => {
  test('a shoved goblin is no longer prone when its own turn begins', async () => {
    participants = [
      seat('player', 'The Scholar', 'player'),
      seat('goblin', 'Goblin', 'monster', [cond('c-prone', 'Prone', 'combat_check')]),
    ];

    await settle('goblin');

    expect(removed).toEqual(['c-prone']);
    expect(facts).toEqual(['Goblin spends half its movement to stand up and is no longer prone.']);
  });

  test('it stays prone while another creature takes its turn', async () => {
    participants = [
      seat('player', 'The Scholar', 'player'),
      seat('goblin', 'Goblin', 'monster', [cond('c-prone', 'Prone', 'combat_check')]),
    ];

    await settle('player');

    expect(removed).toEqual([]);
  });

  test('a Prone the engine did not write for a check is left alone', async () => {
    participants = [seat('goblin', 'Goblin', 'monster', [cond('c-prone', 'Prone', 'Pit trap')])];

    await settle('goblin');

    expect(removed).toEqual([]);
  });
});

describe('round expiry', () => {
  test('a new round expires the encounter’s timed conditions, with the new round number', async () => {
    await settle('player', true, 3);

    expect(advanced).toEqual([{ encounterId: 'encounter-1', round: 3 }]);
  });

  test('a turn inside the round does not', async () => {
    await settle('player', false, 2);

    expect(advanced).toEqual([]);
  });
});

describe('Grappled ends when the grappler lets go (SRD 5.1)', () => {
  const grappled = () => [cond('c-grapple', 'Grappled', 'combat_check:grappler:player')];

  test('it holds while the grappler is standing and within reach', async () => {
    participants = [
      seat('player', 'The Scholar', 'player'),
      seat('goblin', 'Goblin', 'monster', grappled()),
    ];
    entities = [
      { id: 'player', x: 1, y: 1 },
      { id: 'goblin', x: 2, y: 1 },
    ];

    await settle('goblin');

    expect(removed).toEqual([]);
  });

  test('it ends when the grappler is down at 0 HP', async () => {
    participants = [
      { ...seat('player', 'The Scholar', 'player'), status: { currentHp: 0 } },
      seat('goblin', 'Goblin', 'monster', grappled()),
    ];

    await settle('player');

    expect(removed).toEqual(['c-grapple']);
    expect(facts).toEqual(['Goblin is no longer grappled: its grappler is incapacitated.']);
  });

  test('it ends when the grappler is incapacitated by a condition', async () => {
    participants = [
      seat('player', 'The Scholar', 'player', [cond('c-stun', 'Stunned', null)]),
      seat('goblin', 'Goblin', 'monster', grappled()),
    ];

    await settle('goblin');

    expect(removed).toEqual(['c-grapple']);
  });

  test('it ends when the target is moved out of the grappler’s reach', async () => {
    participants = [
      seat('player', 'The Scholar', 'player'),
      seat('goblin', 'Goblin', 'monster', grappled()),
    ];
    // Three cells apart is 15 feet; reach is 5.
    entities = [
      { id: 'player', x: 1, y: 1 },
      { id: 'goblin', x: 4, y: 1 },
    ];

    await settle('goblin');

    expect(removed).toEqual(['c-grapple']);
    expect(facts).toEqual(['Goblin is no longer grappled: it is out of its grappler’s reach.']);
  });

  test('it ends when the grappler has left the fight', async () => {
    participants = [
      { ...seat('player', 'The Scholar', 'player'), isActive: false },
      seat('goblin', 'Goblin', 'monster', grappled()),
    ];

    await settle('goblin');

    expect(removed).toEqual(['c-grapple']);
  });
});

test('a failure to settle never stops the turn from advancing', async () => {
  participants = null as never;

  await expect(settle('goblin')).resolves.toBeUndefined();
});
