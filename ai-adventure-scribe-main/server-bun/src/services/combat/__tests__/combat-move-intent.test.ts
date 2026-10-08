import { describe, expect, mock, test } from 'bun:test';
import { getTableColumns, getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  campaigns,
  combatEncounters,
  combatParticipants,
  gameSessions,
  tacticalMaps,
} from '../../../../../db/schema/index.js';
import { getDistance, resetMovement } from '../../../tactical/engine.js';

import type { TacticalMap } from '../../../tactical/types.js';

process.env.DATABASE_URL ??= 'postgres://test.invalid/unused';

const encounter = {
  id: 'encounter-1',
  sessionId: 'session-1',
  status: 'active',
  version: 1,
};
const scholar = {
  id: 'scholar-1',
  name: 'The Scholar',
  participantType: 'player',
  isActive: true,
  actionUsed: false,
  bonusActionUsed: false,
  armorClass: 11,
  turnOrder: 0,
  encounterId: encounter.id,
};
const golem = {
  id: 'golem-1',
  name: 'Gravity Golem',
  participantType: 'monster',
  isActive: true,
  actionUsed: false,
  bonusActionUsed: false,
  armorClass: 17,
  turnOrder: 1,
  encounterId: encounter.id,
};
/**
 * Ability scores per participant, in the shape `getParticipantAbilityProfile` really returns:
 * `scores` keyed by the short ability name (`str`, `dex`, …), all six always present, plus a
 * level. The real reader takes these from `character_stats` for a player and from the NPC's
 * authored `stats` jsonb for a creature, so a fixture that omits a key is not a shape production
 * ever sends.
 */
const statsById = new Map<string, Record<string, number>>([
  [
    scholar.id,
    // STR 16 (+3) for the shove/grapple contests; DEX 14 (+4) for the hide; CHA 12 (+1) to parley.
    { str: 16, dex: 14, con: 14, int: 10, wis: 14, cha: 12 },
  ],
  [
    golem.id,
    // STR 8 (-1): a weak Athletics the player beats on a good roll. WIS 10 => passive Perception 10.
    { str: 8, dex: 8, con: 16, int: 6, wis: 10, cha: 6 },
  ],
]);

/**
 * A second hostile that LEADS the roster but has the LOWER passive Perception of the two.
 *
 * WIS 6 is -2, so its passive Perception is 8 while the Golem's WIS 10 gives 10. Ordering it
 * first is what makes the two-hostile hide test able to tell the rules apart: a reader that took
 * the first hostile would answer 8, and only a reader that takes the highest answers 10.
 */
const watcher = {
  id: 'watcher-1',
  name: 'Ogre',
  participantType: 'monster',
  isActive: true,
  actionUsed: false,
  bonusActionUsed: false,
  armorClass: 11,
  encounterId: encounter.id,
};
statsById.set(watcher.id, { str: 14, dex: 12, con: 16, int: 7, wis: 6, cha: 7 });

const buildMap = (): TacticalMap => ({
  id: 'map-1',
  sessionId: encounter.sessionId,
  width: 14,
  height: 10,
  round: 1,
  sceneDescription: 'test',
  cells: Array.from({ length: 10 }, () =>
    Array.from({ length: 14 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: scholar.id,
      name: scholar.name,
      x: 1,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: golem.id,
      name: golem.name,
      x: 11,
      y: 7,
      size: 'large',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

type Row = Record<string, any>;
const rows = new Map<string, Row[]>();
const dialect = new PgDialect();
const matches = (table: any, condition: SQL | undefined, row: Row): boolean => {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  const columns = getTableColumns(table);
  return [...query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)].every((match) => {
    const key = Object.keys(columns).find((key) => columns[key].name === match[1])!;
    return row[key] === query.params[Number(match[2]) - 1];
  });
};
const db: any = {
  select: () => {
    let table: any;
    let condition: SQL | undefined;
    const query: any = {
      from: (value: any) => {
        table = value;
        return query;
      },
      where: (value: SQL) => {
        condition = value;
        return query;
      },
      orderBy: () => query,
      limit: () => query,
      then: (resolve: (value: Row[]) => unknown) =>
        resolve(
          structuredClone(
            (rows.get(getTableName(table)) ?? []).filter((row) => matches(table, condition, row)),
          ),
        ),
    };
    return query;
  },
  update: (table: any) => ({
    set: (values: Row) => {
      let condition: SQL | undefined;
      const execute = (): Row[] => {
        const changed = (rows.get(getTableName(table)) ?? []).filter((row) =>
          matches(table, condition, row),
        );
        for (const row of changed)
          for (const [key, value] of Object.entries(values)) {
            row[key] = value instanceof SQL ? Number(row[key]) + 1 : structuredClone(value);
          }
        return structuredClone(changed);
      };
      const query: any = {
        where: (value: SQL) => {
          condition = value;
          return query;
        },
        returning: async () => execute(),
        then: (resolve: (value: Row[]) => unknown) => resolve(execute()),
      };
      return query;
    },
  }),
  transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
};
mock.module('../npc-engine-row.js', () => ({ writeNpcEngineRow: async () => [], readNpcEngineResult: async () => undefined }));
mock.module('../../../../../db/client', () => ({
  withNpcActionTransaction: async (_id: string, work: () => Promise<unknown>) => work(), db }));

async function readState() {
  const [storedEncounter] = await db.select().from(combatEncounters);
  const participants = await db.select().from(combatParticipants);
  return {
    encounter: storedEncounter,
    participants,
    currentParticipant: participants.find(
      (row: Row) => row.id === storedEncounter.currentParticipantId,
    ),
  };
}

async function readParticipant() {
  const persisted = await readState();
  const map = (await loadActiveTacticalMap(encounter.sessionId))!;
  const entity = map.entities.find((row) => row.id === scholar.id)!;
  const hostile = map.entities.find((row) => row.id === golem.id)!;
  return {
    ...persisted.participants.find((row: Row) => row.id === scholar.id),
    ...entity,
    distanceFeet: getDistance(entity, hostile),
    currentParticipantId: persisted.encounter.currentParticipantId,
    round: persisted.encounter.currentRound,
  };
}
const index = {
  resolve: (token: string) => token,
  slugFor: (id: string) => id,
  roster: () => 'The Scholar, Gravity Golem',
};

mock.module('../combat-encounter-service.js', () => ({
  CombatEncounterService: { getCombatState: readState },
}));
mock.module('../combat-intent-refs.js', () => ({
  resolveCombatIntentRefsWithRetry: async (submitted: unknown) => ({
    state: await readState(),
    index,
    resolved: submitted,
  }),
}));
mock.module('../combat-intent-turn.js', () => ({
  assertActorTurn: (state: any) => ({
    actor: state.currentParticipant,
    encounter: state.encounter,
    deathSaves: [],
  }),
}));
mock.module('../session-entity-index.js', () => ({
  loadSessionEntityIndex: async () => index,
}));
mock.module('../combat-events.js', () => ({ trackCombatEvent: () => {} }));
mock.module('../combat-sync-service.js', () => ({ publishCombatState: async () => {} }));
mock.module('../combat-ending.js', () => ({ concludeEncounter: async () => {} }));
mock.module('../combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    advanceTurn: async () => {
      await db.update(combatEncounters).set({ currentParticipantId: golem.id });
      return { currentParticipant: (await readState()).currentParticipant };
    },
  },
}));
// The real module lives one directory up; an NPC's spent action advances the turn through it.
mock.module('../../combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    advanceTurn: async () => {
      await db.update(combatEncounters).set({ currentParticipantId: golem.id });
      return { currentParticipant: (await readState()).currentParticipant };
    },
  },
}));
mock.module('../combat-approach-service.js', () => ({
  decideAttackApproach: async () => ({ movementOnly: false }),
  describeResolvedAttack: () => '',
  describeUnreachableApproach: () => '',
}));
mock.module('../data-access.js', () => ({
  // The real reader returns the participant's own profile: scores keyed str/dex/con/int/wis/cha
  // and a level. Fixtures below carry every key so a check cannot pass by reading a missing one.
  getParticipantAbilityProfile: async (participant: any) => ({
    level: 1,
    scores: statsById.get(participant.id) ?? {},
    savingThrowProficiencies: [],
    saveBonuses: {},
    spellIds: [],
  }),
  getActiveConditionNames: async () => [],
  listEquippedWeaponProfiles: async () => [
    {
      id: 'quarterstaff',
      name: 'Quarterstaff',
      damageDice: '1d6',
      damageType: 'bludgeoning',
      normalRange: 5,
      magicBonus: 1,
      finesse: false,
      ranged: false,
      proficient: true,
    },
  ],
}));
mock.module('../death-saves-service.js', () => ({
  describeGoingDown: () => '',
  settleDownedTurns: async () => ({ awaitingDeathSave: false }),
  rollOwedDeathSave: async () => ({}),
  planStableWake: async () => [],
  applyStableWake: async () => [],
  vitalStateOf: () => 'standing',
}));
mock.module('../tactical-combat-lifecycle.js', () => ({
  grantTacticalDash: async () => ({ applied: true }),
  resetTacticalMovementForTurn: async () => {},
}));
mock.module('../../collaboration/room-manager.js', () => ({ broadcastToRoom: () => {} }));
/**
 * The one writer that owns participant conditions. Recorded rather than executed so a test can
 * assert WHICH condition landed on WHICH participant, which is the part of #2420 that has to
 * hold: a shove writes Prone, a grapple writes Grappled, a miss writes nothing.
 */
const appliedConditions: Array<{ participantId: string; condition: string }> = [];
const removedConditions: string[] = [];
mock.module('../../conditions-service.js', () => ({
  ConditionsService: {
    applyCondition: async (participantId: string, _encounterId: string, condition: string) => {
      appliedConditions.push({ participantId, condition });
      return { condition: { name: condition }, warnings: [] };
    },
    removeCondition: async (conditionId: string) => {
      removedConditions.push(conditionId);
      return true;
    },
  },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { loadActiveTacticalMap, saveTacticalMap } = await import('../tactical-map-store.js');
const { claimTurnActionAndResolve, resetTurnResources } =
  await import('../combat-turn-resources.js');
const { consumeDmTacticalFacts } = await import('../tactical-action-service.js');
const { executeCombatIntent, getLegalCombatActions } = await import('../combat-intent-service.js');
const { advanceNpcTurns } = await import('../npc-turn-runner.js');
const { isParleyHeld } = await import('../parley-hold.js');

/** Seed the encounter for a check: the Scholar holds the turn and the Golem is in reach. */
async function seedCheckEncounter(extra: Record<string, unknown>[] = []): Promise<number> {
  rows.set(getTableName(combatEncounters), [
    { ...encounter, currentParticipantId: scholar.id, currentRound: 1 },
  ]);
  // `extra` leads the roster, so a reader that took the FIRST hostile instead of the highest
  // would disagree with a reader that takes the highest — which is what makes the two-hostile
  // hide test able to tell the two rules apart.
  rows.set(getTableName(combatParticipants), structuredClone([...extra, scholar, golem]));
  rows.set(getTableName(tacticalMaps), [
    { id: 'map-row-1', sessionId: encounter.sessionId, active: true, state: buildMap() },
  ]);
  appliedConditions.length = 0;
  removedConditions.length = 0;
  const version = (await readState()).encounter.version;
  return version;
}

/**
 * Pin the dice the ENGINE rolls for a check, without threading a seam through production code.
 *
 * A check has two dice: the player's, which the caller supplies as `d20`, and the target's, which
 * the engine always rolls itself (the player never rolls the goblin's defence). Only the second
 * is random from the caller's point of view, so this is the only one a test has to fix. Stubbing
 * `Math.random` — the d20 helper's source — keeps the production path untouched.
 */
function withRolledFaces(faces: number[], run: () => Promise<void>): Promise<void> {
  const original = Math.random;
  let index = 0;
  Math.random = () => {
    const face = faces[index % faces.length];
    index += 1;
    return (face - 1) / 20 + 1e-9;
  };
  return run().finally(() => {
    Math.random = original;
  });
}

/** Run one `check` intent and hand back the service's result plus the current encounter version. */
async function runCheck(
  check: Record<string, unknown>,
  /** The faces the engine rolls, in order. Defaults to a single mid-range d20. */
  engineFaces: number[] = [8],
): Promise<{ result: any; version: number }> {
  const version = await seedCheckEncounter();
  let result: any;
  await withRolledFaces(engineFaces, async () => {
    result = await executeCombatIntent(
      encounter.id,
      { type: 'check', actorId: scholar.id, expectedVersion: version, ...check } as never,
      'user-1',
      'dm',
      undefined,
      'typed',
    );
  });
  return { result, version };
}

describe('mid-combat ability checks (#2420)', () => {
  test('a successful shove applies Prone, writes the engine line and spends the action', async () => {
    const { result } = await runCheck({
      checkKind: 'shove',
      targetId: golem.id,
      // STR 16 is +3, so a natural 11 is 14 against a STR 8 Golem's weak Athletics.
      d20: 11,
    });

    expect(result.success).toBe(true);
    expect(result.conditionApplied).toEqual({ participantId: golem.id, condition: 'Prone' });
    expect(appliedConditions).toEqual([{ participantId: golem.id, condition: 'Prone' }]);
    // The engine line names the roll, the contest and what happened — never just "you succeeded".
    expect(result.engineLine).toContain('Shove: 14 (nat 11+3)');
    expect(result.engineLine).toContain('Athletics');
    expect(result.engineLine).toContain('success');
    expect(result.engineLine).toContain('prone');
    // The action is spent: a check costs the turn exactly like an attack.
    expect(
      (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
    ).toBe(true);
  });

  test('the engine line reaches the DM prompt as a fact', async () => {
    const { result } = await runCheck({ checkKind: 'shove', targetId: golem.id, d20: 11 });
    const facts = await consumeDmTacticalFacts(encounter.sessionId);

    expect(facts).toHaveLength(1);
    expect(facts[0]).toContain(result.engineLine);
  });

  test('a failed shove leaves the target unchanged', async () => {
    // Player STR 16 (+3) on a natural 1 is 4; the Golem's STR 8 is -1, so an engine 20 is 19.
    const { result } = await runCheck(
      {
        checkKind: 'shove',
        targetId: golem.id,
        d20: 1,
      },
      [20],
    );

    expect(result.success).toBe(false);
    expect(appliedConditions).toEqual([]);
    expect(result.conditionApplied).toBeUndefined();
    expect(result.engineLine).toContain('failure');
    expect(result.engineLine).toContain('nothing changes');
    // The action is still spent: the attempt was made, it failed.
    expect(
      (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
    ).toBe(true);
  });

  test('a shove the player chose to push records the push instead of a condition', async () => {
    const { result } = await runCheck({
      checkKind: 'shove',
      targetId: golem.id,
      shoveOutcome: 'push',
      d20: 11,
    });

    expect(result.success).toBe(true);
    expect(appliedConditions).toEqual([]);
    expect(result.engineLine).toContain('pushed 5 feet');
  });

  test('a successful grapple applies Grappled', async () => {
    const { result } = await runCheck({ checkKind: 'grapple', targetId: golem.id, d20: 11 });

    expect(result.success).toBe(true);
    expect(appliedConditions).toEqual([{ participantId: golem.id, condition: 'Grappled' }]);
    expect(result.engineLine).toContain('Grapple');
    // Grappled's speed-0 effect comes from the library row, so the line states it too.
    expect(result.engineLine).toContain('grappled, speed 0');
  });

  test('a hide is measured against the highest passive Perception in the room', async () => {
    // The Golem's WIS 10 gives passive Perception 10, and the player's DEX 14 is +2, so a natural 10
    // totals 12 and clears it.
    const { result } = await runCheck({ checkKind: 'hide', d20: 10 });

    expect(result.opposedBy).toBe(10);
    expect(result.actorRoll.total).toBe(12);
    expect(result.success).toBe(true);
    expect(result.engineLine).toContain('vs passive Perception 10');
  });

  test('a hide fails when the highest passive Perception beats the roll', async () => {
    // DEX 14 (+2) on a natural 1 is 3, under the Golem's passive Perception of 10.
    const { result } = await runCheck({ checkKind: 'hide', d20: 1 });

    expect(result.opposedBy).toBe(10);
    expect(result.success).toBe(false);
  });

  test('a hide against two hostiles is measured against the HIGHEST passive Perception', async () => {
    // Two hostiles: the Ogre's passive Perception 8 (WIS 6) leads the roster, and the Golem's WIS 10
    // gives 10. The check must meet 10 — the highest, not the first. The Ogre leads deliberately,
    // so a reader that took the first hostile would answer 8 and pass a roll this must fail.
    const version = await seedCheckEncounter([watcher]);
    let result: any;
    await withRolledFaces([8], async () => {
      result = await executeCombatIntent(
        encounter.id,
        // DEX 14 (+2) on a natural 6 is 8: clears the Ogre's 8, fails the Golem's 10.
        {
          type: 'check',
          actorId: scholar.id,
          expectedVersion: version,
          checkKind: 'hide',
          d20: 6,
        } as never,
        'user-1',
        'dm',
        undefined,
        'typed',
      );
    });

    expect(result.opposedBy).toBe(10);
    expect(result.actorRoll.total).toBe(8);
    expect(result.success).toBe(false);
    expect(result.engineLine).toContain('vs passive Perception 10');
  });

  test('a parley sets a DC and records the fact the DM must honour, with no surrender', async () => {
    const { result } = await runCheck({
      checkKind: 'parley',
      parleySkill: 'intimidate',
      targetId: golem.id,
      // CHA 12 is +1, so a natural 20 is 21 — well over the default DC 15.
      d20: 20,
    });

    expect(result.parleyDc).toBe(15);
    expect(result.success).toBe(true);
    // Talking grants no condition.
    expect(appliedConditions).toEqual([]);
    // The engine records a parley — the target holds its action — and never a surrender.
    expect(result.dmFact).toContain('holds its next action');
    expect(result.dmFact).toContain('NOT surrendered');
    expect(result.engineLine).toContain('Intimidation');
  });

  test('a FAILED parley does not tell the DM the creature stood down', async () => {
    // CHA 12 (+1) on a natural 1 is 2, far under the default DC 15.
    const { result } = await runCheck({
      checkKind: 'parley',
      parleySkill: 'persuade',
      targetId: golem.id,
      d20: 1,
    });

    expect(result.success).toBe(false);
    // The failure must not carry a stand-down: that is the fabricated-outcome shape #2396 exists
    // to prevent, and the engine line beside it would otherwise contradict the fact.
    expect(result.dmFact).not.toContain('PARLEY');
    expect(result.dmFact).not.toContain('holds its action');
    expect(result.dmFact).toContain('FAILED');
    expect(result.dmFact).toContain('still attacks');
    expect(result.engineLine).toContain('failure');
  });

  test('a successful hide records that the player is hidden', async () => {
    const { result } = await runCheck({ checkKind: 'hide', d20: 10 });

    expect(result.success).toBe(true);
    // A hide targets nobody, so the outcome must survive the no-target path or the win records
    // nothing at all.
    expect(result.engineLine).toContain('hidden');
  });

  test('a stale version is refused, so two racing clients cannot both resolve the check', async () => {
    const version = await seedCheckEncounter();
    const intent = {
      type: 'check',
      actorId: scholar.id,
      expectedVersion: version,
      checkKind: 'shove',
      targetId: golem.id,
      d20: 11,
    } as const;

    await executeCombatIntent(encounter.id, intent as never, 'user-1', 'dm', undefined, 'typed');
    // The first check bumped the encounter version, so the replay carries a stale one. Pinned to the
    // VERSION guard specifically, not "some refusal": the check claims the encounter version
    // exactly as an attack does, and a second client holding the pre-check version must be turned
    // away before it can spend anything.
    await expect(
      executeCombatIntent(encounter.id, intent as never, 'user-1', 'dm', undefined, 'typed'),
    ).rejects.toThrow(/Combat state changed/);
  });

  test('a check cannot be resolved twice in one turn', async () => {
    const version = await seedCheckEncounter();
    const build = (expectedVersion: number) =>
      ({
        type: 'check',
        actorId: scholar.id,
        expectedVersion,
        checkKind: 'shove',
        targetId: golem.id,
        d20: 11,
      }) as const;

    await executeCombatIntent(
      encounter.id,
      build(version) as never,
      'user-1',
      'dm',
      undefined,
      'typed',
    );
    // The replay reads the CURRENT version, so only the action claim can refuse it — which is
    // what proves the check spent the player's one action for the turn.
    const after = (await readState()).encounter.version;
    await expect(
      executeCombatIntent(encounter.id, build(after) as never, 'user-1', 'dm', undefined, 'typed'),
    ).rejects.toThrow(/Action already used/);
  });

  test('a client check posts no expectedVersion and still resolves and spends the action', async () => {
    await seedCheckEncounter();

    // The body the client really posts (`runDeclaredCombatCheck`): source `dm`, origin `typed`, and
    // no `expectedVersion` key, because a DM-sourced intent has the server read the version. The
    // other tests here always pass one, which is how an unlisted `check` type went unnoticed.
    let result: any;
    await withRolledFaces([8], async () => {
      result = await executeCombatIntent(
        encounter.id,
        {
          type: 'check',
          actorId: scholar.id,
          checkKind: 'shove',
          targetId: golem.id,
          d20: 11,
        } as never,
        'user-1',
        'dm',
        undefined,
        'typed',
      );
    });

    expect(result.success).toBe(true);
    expect(
      (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
    ).toBe(true);
  });

  test('a DM-structured monster shoves with its stored stat-block scores, not +0', async () => {
    // Seated the way a DM-structured combat start seats a creature: no `characterId`, no `npcId`.
    // The real reader returns `scores: {}` for that row (statsById has no entry for it), so the
    // printed scores can only come from the row's stored `monsterAttack`.
    const ogre = {
      id: 'ogre-2',
      name: 'Hill Ogre',
      participantType: 'monster',
      characterId: null,
      npcId: null,
      isActive: true,
      actionUsed: false,
      bonusActionUsed: false,
      armorClass: 11,
      encounterId: encounter.id,
      monsterAttack: {
        source: 'catalog',
        attacks: [],
        abilityScores: { str: 21, dex: 8, con: 19, int: 5, wis: 7, cha: 7 },
      },
    };
    const version = await seedCheckEncounter([ogre]);
    let result: any;
    // Engine die 8 + STR 21 (+5) = 13. The player's nat 8 + 3 = 11 loses; read as +0 the ogre
    // would total 8 and the same roll would win.
    await withRolledFaces([8], async () => {
      result = await executeCombatIntent(
        encounter.id,
        {
          type: 'check',
          actorId: scholar.id,
          expectedVersion: version,
          checkKind: 'shove',
          targetId: ogre.id,
          d20: 8,
        } as never,
        'user-1',
        'dm',
        undefined,
        'typed',
      );
    });

    expect(result.success).toBe(false);
    expect(result.opposedBy).toBe(13);
    expect(result.engineLine).toContain('Athletics 13');
    expect(appliedConditions).toEqual([]);
  });

  test('a grapple records its grappler on the condition, with no timer; a shove expires in a round', async () => {
    const applied: Array<unknown[]> = [];
    const { ConditionsService } = await import('../../conditions-service.js');
    const original = ConditionsService.applyCondition;
    (ConditionsService as any).applyCondition = async (...args: unknown[]) => {
      applied.push(args);
      return { condition: { name: args[2] }, warnings: [] };
    };
    try {
      await runCheck({ checkKind: 'grapple', targetId: golem.id, d20: 11 });
      await runCheck({ checkKind: 'shove', targetId: golem.id, d20: 11 });
    } finally {
      (ConditionsService as any).applyCondition = original;
    }

    // [participantId, encounterId, condition, durationType, durationValue, saveDc, saveAbility, source]
    expect(applied[0].slice(2)).toEqual([
      'Grappled',
      'permanent',
      undefined,
      undefined,
      undefined,
      `combat_check:grappler:${scholar.id}`,
    ]);
    expect(applied[1].slice(2)).toEqual([
      'Prone',
      'rounds',
      1,
      undefined,
      undefined,
      'combat_check',
    ]);
  });

  describe('engine lines say the outcome once (#2420)', () => {
    test('a won shove', async () => {
      const { result } = await runCheck({ checkKind: 'shove', targetId: golem.id, d20: 11 });

      expect(result.engineLine).toBe(
        'Shove: 14 (nat 11+3) vs Athletics 7 — success, Gravity Golem is prone',
      );
    });

    test('a lost shove', async () => {
      const { result } = await runCheck({ checkKind: 'shove', targetId: golem.id, d20: 1 }, [20]);

      expect(result.engineLine).toBe(
        'Shove: 4 (nat 1+3) vs Athletics 19 — failure, nothing changes',
      );
    });

    test('a won hide has the player as its subject', async () => {
      const { result } = await runCheck({ checkKind: 'hide', d20: 10 });

      expect(result.engineLine).toBe(
        'Hide: 12 (nat 10+2) vs passive Perception 10 — success, The Scholar is hidden until an attack or discovery',
      );
    });

    test('a won parley names the creature that holds', async () => {
      const { result } = await runCheck({
        checkKind: 'parley',
        parleySkill: 'persuade',
        targetId: golem.id,
        d20: 20,
      });

      expect(result.engineLine).toBe(
        'Persuasion: 21 (nat 20+1) vs DC 15 — success, Gravity Golem holds its next action',
      );
    });
  });

  describe('the hide DC counts only hostile, standing creatures (#2420)', () => {
    const watcherWith = (extra: Record<string, unknown>, wis: number, id: string) => {
      statsById.set(id, { str: 10, dex: 10, con: 10, int: 10, wis, cha: 10 });
      return { ...watcher, id, name: `Watcher ${id}`, ...extra };
    };

    async function hideAgainst(extra: Record<string, unknown>[]): Promise<any> {
      const version = await seedCheckEncounter(extra);
      let result: any;
      await withRolledFaces([8], async () => {
        result = await executeCombatIntent(
          encounter.id,
          {
            type: 'check',
            actorId: scholar.id,
            expectedVersion: version,
            checkKind: 'hide',
            d20: 10,
          } as never,
          'user-1',
          'dm',
          undefined,
          'typed',
        );
      });
      return result;
    }

    test('a friendly, a neutral and a downed creature with high Perception do not raise it', async () => {
      // WIS 20 is passive Perception 15 for each of the three; the Golem's own is 10.
      const result = await hideAgainst([
        watcherWith({ disposition: 'friendly' }, 20, 'friend-1'),
        watcherWith({ disposition: 'neutral' }, 20, 'neutral-1'),
        watcherWith({ status: { currentHp: 0 } }, 20, 'downed-1'),
      ]);

      expect(result.opposedBy).toBe(10);
      expect(result.success).toBe(true);
    });

    test('a hostile with high Perception does raise it', async () => {
      const result = await hideAgainst([watcherWith({}, 20, 'hostile-1')]);

      expect(result.opposedBy).toBe(15);
      expect(result.success).toBe(false);
    });

    test('a provoked neutral is searching', async () => {
      const result = await hideAgainst([
        watcherWith({ disposition: 'neutral', provoked: true }, 20, 'angry-1'),
      ]);

      expect(result.opposedBy).toBe(15);
    });
  });

  describe('a shove or grapple needs a target no more than one size larger (#2420)', () => {
    async function setSize(id: string, size: string): Promise<void> {
      const map = (await loadActiveTacticalMap(encounter.sessionId))!;
      map.entities.find((entity) => entity.id === id)!.size = size as never;
      await saveTacticalMap(map);
    }

    const attempt = (version: number, checkKind: string): Promise<any> =>
      executeCombatIntent(
        encounter.id,
        {
          type: 'check',
          actorId: scholar.id,
          expectedVersion: version,
          checkKind,
          targetId: golem.id,
          d20: 11,
        } as never,
        'user-1',
        'dm',
        undefined,
        'typed',
      );

    test.each(['shove', 'grapple'])(
      'a Medium player %s on a Huge target is refused, with the reason, and spends nothing',
      async (checkKind) => {
        const version = await seedCheckEncounter();
        await setSize(golem.id, 'huge');

        await expect(attempt(version, checkKind)).rejects.toThrow(
          /\(medium\) cannot .* Gravity Golem \(huge\).*no more than one size larger/,
        );

        expect(
          (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
        ).toBe(false);
        expect(appliedConditions).toEqual([]);
        // Nothing was claimed: the version did not move, so the same version still works.
        expect((await readState()).encounter.version).toBe(version);
        await setSize(golem.id, 'large');
        await withRolledFaces([8], async () => {
          expect((await attempt(version, checkKind)).success).toBe(true);
        });
      },
    );

    test('a Large target proceeds', async () => {
      const version = await seedCheckEncounter();
      await setSize(golem.id, 'large');

      await withRolledFaces([8], async () => {
        expect((await attempt(version, 'shove')).success).toBe(true);
      });
    });

    test('a Small actor may shove a Medium target but not a Large one', async () => {
      const version = await seedCheckEncounter();
      await setSize(scholar.id, 'small');
      await setSize(golem.id, 'medium');
      await withRolledFaces([8], async () => {
        expect((await attempt(version, 'shove')).success).toBe(true);
      });

      const next = await seedCheckEncounter();
      await setSize(scholar.id, 'small');
      await setSize(golem.id, 'large');
      await expect(attempt(next, 'shove')).rejects.toThrow(/no more than one size larger/);
    });

    test('size does not limit a parley', async () => {
      const version = await seedCheckEncounter();
      await setSize(golem.id, 'gargantuan');

      await withRolledFaces([8], async () => {
        const result: any = await executeCombatIntent(
          encounter.id,
          {
            type: 'check',
            actorId: scholar.id,
            expectedVersion: version,
            checkKind: 'parley',
            parleySkill: 'persuade',
            targetId: golem.id,
            d20: 20,
          } as never,
          'user-1',
          'dm',
          undefined,
          'typed',
        );
        expect(result.success).toBe(true);
      });
    });
  });

  describe('escaping a grapple (#2420)', () => {
    const grappledBy = (grapplerId: string) => [
      {
        id: 'c-grapple',
        isActive: true,
        sourceDescription: `combat_check:grappler:${grapplerId}`,
        condition: { name: 'Grappled' },
      },
    ];
    const setConditions = (id: string, conditions: unknown[]) => {
      rows.get(getTableName(combatParticipants))!.find((row) => row.id === id)!.conditions =
        conditions;
    };
    const escapeIntent = (actorId: string, extra: Record<string, unknown> = {}) =>
      ({ type: 'check', actorId, checkKind: 'escape', ...extra }) as never;

    test('a grappled player who wins the contest is freed and spends the action', async () => {
      const version = await seedCheckEncounter();
      setConditions(scholar.id, grappledBy(golem.id));
      let result: any;
      // STR 16 (+3), nat 11 = 14 against the Golem's Athletics: engine 8, STR 8 (-1) = 7.
      await withRolledFaces([8], async () => {
        result = await executeCombatIntent(
          encounter.id,
          escapeIntent(scholar.id, { expectedVersion: version, d20: 11 }),
          'user-1',
          'dm',
          undefined,
          'typed',
        );
      });

      expect(result.success).toBe(true);
      expect(removedConditions).toEqual(['c-grapple']);
      expect(result.conditionRemoved).toEqual({ participantId: scholar.id, condition: 'Grappled' });
      expect(result.engineLine).toBe(
        "Escape: 14 (nat 11+3) vs Athletics 7 — success, The Scholar breaks free of Gravity Golem's grapple",
      );
      expect(
        (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
      ).toBe(true);
    });

    test('a grappled player who loses stays grappled, and the action is still spent', async () => {
      const version = await seedCheckEncounter();
      setConditions(scholar.id, grappledBy(golem.id));
      let result: any;
      await withRolledFaces([20], async () => {
        result = await executeCombatIntent(
          encounter.id,
          escapeIntent(scholar.id, { expectedVersion: version, d20: 1 }),
          'user-1',
          'dm',
          undefined,
          'typed',
        );
      });

      expect(result.success).toBe(false);
      expect(removedConditions).toEqual([]);
      expect(result.engineLine).toBe(
        'Escape: 4 (nat 1+3) vs Athletics 19 — failure, nothing changes',
      );
      expect(
        (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
      ).toBe(true);
    });

    test('a player who is not grappled is refused and spends nothing', async () => {
      const version = await seedCheckEncounter();

      await expect(
        executeCombatIntent(
          encounter.id,
          escapeIntent(scholar.id, { expectedVersion: version, d20: 11 }),
          'user-1',
          'dm',
          undefined,
          'typed',
        ),
      ).rejects.toThrow(/is not grappled/);

      expect(
        (await readState()).participants.find((row: Row) => row.id === scholar.id).actionUsed,
      ).toBe(false);
    });

    test('a grappled NPC escapes on its own turn: the engine rolls both dice and frees it', async () => {
      const version = await seedCheckEncounter();
      setConditions(golem.id, grappledBy(scholar.id));
      await db.update(combatEncounters).set({ currentParticipantId: golem.id });
      let result: any;
      // Engine dice in order: the Golem's (20), then the grappler's (1). STR 8 (-1) + 20 = 19
      // against the Scholar's STR 16 (+3) + 1 = 4.
      await withRolledFaces([20, 1], async () => {
        result = await executeCombatIntent(
          encounter.id,
          {
            type: 'check',
            actorId: golem.id,
            checkKind: 'escape',
            expectedVersion: version,
          } as never,
          'user-1',
          'dm',
        );
      });

      expect(result.success).toBe(true);
      expect(removedConditions).toEqual(['c-grapple']);
      expect(result.engineLine).toBe(
        "Escape: 19 (nat 20-1) vs Athletics 4 — success, Gravity Golem breaks free of The Scholar's grapple",
      );
    });
  });

  describe("a won parley holds the target's action (#2420)", () => {
    const weapon = {
      id: 'club',
      name: 'Club',
      damageDice: '1d6',
      damageType: 'bludgeoning',
      normalRange: 5,
      magicBonus: 0,
      finesse: false,
      ranged: false,
      proficient: true,
    };

    /** The NPC runner, driven against this file's real map store and encounter rows. */
    async function runGolemTurn(): Promise<string[]> {
      await db.update(combatEncounters).set({ currentParticipantId: golem.id });
      const intents: string[] = [];
      await advanceNpcTurns(encounter.id, 'user-1', {
        getCombatState: readState as never,
        getDefaultWeapon: async () => weapon,
        executeIntent: async (_encounterId, intent) => {
          intents.push((intent as { type: string }).type);
          await db.update(combatEncounters).set({ currentParticipantId: scholar.id });
          return { currentParticipant: scholar };
        },
        isParleyHeld,
      });
      return intents;
    }

    const standUp = () => {
      for (const row of rows.get(getTableName(combatParticipants)) ?? []) row.maxHp = 20;
    };

    test('the held creature ends its turn without attacking; the next round it attacks again', async () => {
      const { result } = await runCheck({
        checkKind: 'parley',
        parleySkill: 'persuade',
        targetId: golem.id,
        d20: 20,
      });
      expect(result.success).toBe(true);
      standUp();

      expect(await runGolemTurn()).toEqual(['end_turn']);

      await db.update(combatEncounters).set({ currentRound: 2 });
      expect(await runGolemTurn()).toEqual(['attack', 'end_turn']);
    });

    test('a target that already acted this round is held at its next turn, the round after', async () => {
      // The Golem is ahead of the Scholar in the order: it has acted in round 1 by the time the
      // Scholar parleys, so the hold belongs to round 2 and round 1 holds nothing.
      const version = await seedCheckEncounter();
      rows.get(getTableName(combatParticipants))!.find((row) => row.id === golem.id)!.turnOrder =
        -1;
      await withRolledFaces([8], async () => {
        await executeCombatIntent(
          encounter.id,
          {
            type: 'check',
            actorId: scholar.id,
            expectedVersion: version,
            checkKind: 'parley',
            parleySkill: 'persuade',
            targetId: golem.id,
            d20: 20,
          } as never,
          'user-1',
          'dm',
          undefined,
          'typed',
        );
      });
      standUp();

      expect(await isParleyHeld(encounter.sessionId, golem.id, 1)).toBe(false);
      expect(await isParleyHeld(encounter.sessionId, golem.id, 2)).toBe(true);
      await db.update(combatEncounters).set({ currentRound: 2 });
      expect(await runGolemTurn()).toEqual(['end_turn']);
    });

    test('a failed parley holds nothing', async () => {
      const { result } = await runCheck({
        checkKind: 'parley',
        parleySkill: 'persuade',
        targetId: golem.id,
        d20: 1,
      });
      expect(result.success).toBe(false);
      standUp();

      expect(await isParleyHeld(encounter.sessionId, golem.id, 1)).toBe(false);
      expect(await runGolemTurn()).toEqual(['attack', 'end_turn']);
    });
  });

  describe('the parley fact on a campaign that hides target numbers (#2567)', () => {
    let lastResult: any;
    const withDifficulty = async (difficultyLevel: string): Promise<string> => {
      rows.set(getTableName(gameSessions), [
        { id: encounter.sessionId, campaignId: 'campaign-1', starterCampaignId: null },
      ]);
      rows.set(getTableName(campaigns), [{ id: 'campaign-1', difficultyLevel }]);
      try {
        // CHA 12 (+1): a natural 20 is 21 against the default DC 15.
        ({ result: lastResult } = await runCheck({
          checkKind: 'parley',
          parleySkill: 'persuade',
          targetId: golem.id,
          d20: 20,
        }));
        const facts = await consumeDmTacticalFacts(encounter.sessionId);
        expect(facts).toHaveLength(1);
        return facts[0];
      } finally {
        rows.delete(getTableName(gameSessions));
        rows.delete(getTableName(campaigns));
      }
    };

    test('a Hard campaign hands the DM the parley with no DC', async () => {
      const fact = await withDifficulty('hard');

      expect(fact).not.toContain('DC');
      expect(fact).toContain('Persuasion check 21: success');
      // The line the client forwards to the DM carries the DC too: it is dropped there as well,
      // while the player's own Engine line keeps it.
      expect(lastResult.dmEngineLine).not.toContain('DC');
      expect(lastResult.engineLine).toContain('vs DC 15');
    });

    test('an Easy campaign keeps the DC in the parley fact', async () => {
      const fact = await withDifficulty('easy');

      expect(fact).toContain('Persuasion check 21 against DC 15: success');
      expect(lastResult.dmEngineLine).toContain('vs DC 15');
    });
  });
});

describe('authoritative Move intent', () => {
  test('moves the Scholar 30ft toward the Golem, then reaches melee on the next move', async () => {
    rows.set(getTableName(combatEncounters), [
      { ...encounter, currentParticipantId: scholar.id, currentRound: 1 },
    ]);
    rows.set(getTableName(combatParticipants), structuredClone([scholar, golem]));
    rows.set(getTableName(tacticalMaps), [
      { id: 'map-row-1', sessionId: encounter.sessionId, active: true, state: buildMap() },
    ]);
    // Calibrate the double: a real claim must change the independently read stored row.
    await claimTurnActionAndResolve(scholar.id, encounter.id, 1, async () => true);
    expect((await readParticipant()).actionUsed).toBe(true);
    await resetTurnResources(scholar.id, 1);

    const result = await executeCombatIntent(
      encounter.id,
      { type: 'move', actorId: scholar.id, x: 7, y: 7 },
      'user-1',
      'dm',
      undefined,
      'typed',
    );

    expect(result).toMatchObject({ applied: true });
    const firstMovePath = (result as { path: Array<{ x: number; y: number }> }).path;
    expect(firstMovePath).toHaveLength(7);
    expect(firstMovePath.at(-1)).toEqual({ x: 7, y: 7 });
    expect(await readParticipant()).toMatchObject({
      x: 7,
      y: 7,
      distanceFeet: 20,
      movementRemaining: 0,
      actionUsed: false,
      currentParticipantId: scholar.id,
      round: 1,
    });
    expect(await consumeDmTacticalFacts(encounter.sessionId)).toEqual([
      'The Scholar moved to (7, 7) by the engine. Describe the movement and keep the action unused.',
    ]);
    const firstLegal = await getLegalCombatActions(encounter.id, 'user-1');
    expect(firstLegal.actions).toContainEqual(
      expect.objectContaining({
        type: 'attack',
        label: 'Attack with Quarterstaff (move closer first)',
      }),
    );
    const nextTurnMap = (await loadActiveTacticalMap(encounter.sessionId))!;
    resetMovement(nextTurnMap, scholar.id);
    await saveTacticalMap(nextTurnMap);
    const secondMove = await executeCombatIntent(
      encounter.id,
      { type: 'move', actorId: scholar.id, x: 10, y: 7 },
      'user-1',
      'dm',
      undefined,
      'typed',
    );
    expect(secondMove).toMatchObject({ applied: true });
    expect(await readParticipant()).toMatchObject({
      x: 10,
      y: 7,
      movementRemaining: 15,
      distanceFeet: 5,
      actionUsed: false,
      currentParticipantId: scholar.id,
      round: 1,
    });

    const legal = await getLegalCombatActions(encounter.id, 'user-1');
    expect(legal.actions).toContainEqual(
      expect.objectContaining({ type: 'attack', label: 'Attack with Quarterstaff' }),
    );
  });
});
