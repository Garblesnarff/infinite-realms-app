import { describe, expect, mock, test } from 'bun:test';
import { getTableColumns, getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  combatEncounters,
  combatParticipants,
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
  encounterId: encounter.id,
};
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
mock.module('../../../../../db/client', () => ({ db }));

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
mock.module('../combat-approach-service.js', () => ({
  decideAttackApproach: async () => ({ movementOnly: false }),
  describeResolvedAttack: () => '',
  describeUnreachableApproach: () => '',
}));
mock.module('../data-access.js', () => ({
  getParticipantAbilityProfile: async () => ({
    level: 1,
    scores: { str: 10, dex: 10 },
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
  settleDownedTurns: async () => ({ deathSaves: [] }),
  vitalStateOf: () => 'standing',
}));
mock.module('../tactical-combat-lifecycle.js', () => ({
  grantTacticalDash: async () => ({ applied: true }),
  resetTacticalMovementForTurn: async () => {},
}));
mock.module('../../collaboration/room-manager.js', () => ({ broadcastToRoom: () => {} }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { loadActiveTacticalMap, saveTacticalMap } = await import('../tactical-map-store.js');
const { claimTurnActionAndResolve, resetTurnResources } =
  await import('../combat-turn-resources.js');
const { consumeDmTacticalFacts } = await import('../tactical-action-service.js');
const { executeCombatIntent, getLegalCombatActions } = await import('../combat-intent-service.js');

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
