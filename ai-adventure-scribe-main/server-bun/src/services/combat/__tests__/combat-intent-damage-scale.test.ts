import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { getTableColumns, getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  combatEncounters,
  combatParticipants,
  tacticalMaps,
} from '../../../../../db/schema/index.js';

import type { TacticalMap } from '../../../tactical/types.js';

/**
 * Damage-scale wiring at the intent boundary (#2534).
 *
 * The engine line the DM narrates from and the machine-readable DM fact must
 * agree on the damage scale, and both must derive it from the target's real
 * max HP. A movement-only approach resolved movement, not an attack, so its
 * fact carries no damage scale at all.
 */
process.env.DATABASE_URL ??= 'postgres://localhost:5432/test';

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
  maxHp: 10,
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
      x: 2,
      y: 1,
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
  return [...query.sql.matchAll(/\"[^\"]+\"\.\"([^\"]+)\" = \$(\d+)/g)].every((match) => {
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
      const query: any = {
        where: (value: SQL) => {
          condition = value;
          return query;
        },
        then: (resolve: (value: Row[]) => unknown) => {
          const list = rows.get(getTableName(table)) ?? [];
          for (const row of list) {
            if (matches(table, condition, row)) Object.assign(row, structuredClone(values));
          }
          resolve([]);
        },
      };
      return query;
    },
  }),
  insert: () => ({ values: () => ({ then: (resolve: (v: Row[]) => unknown) => resolve([]) }) }),
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
  CombatInitiativeService: { advanceTurn: async () => ({}) },
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

// Captured DM facts: [sessionId, text, fact].
const recordedFacts: Array<[string, string, Record<string, unknown>]> = [];
mock.module('../tactical-action-service.js', () => ({
  applyTacticalMapAction: async () => ({ applied: true }),
  recordDmTacticalFact: async (
    sessionId: string,
    text: string,
    fact?: Record<string, unknown>,
  ) => {
    recordedFacts.push([sessionId, text, fact ?? {}]);
  },
}));

// The attack resolution is stubbed per test.
let attackResolution: Record<string, unknown> = {
  hit: true,
  finalDamage: 1,
  targetNewHp: 9,
  targetId: golem.id,
};
mock.module('../combat-attack-service.js', () => ({
  CombatAttackService: class {
    async resolveAttack() {
      return attackResolution;
    }
  },
}));

let approachResult: { movementOnly: boolean; result?: unknown; attackType?: string };
const { describeResolvedAttack: realDescribeResolvedAttack } = await import(
  '../attack-narration.js'
);
mock.module('../combat-approach-service.js', () => ({
  decideAttackApproach: async () => approachResult,
  describeResolvedAttack: realDescribeResolvedAttack,
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
      magicBonus: 0,
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

const { executeCombatIntent } = await import('../combat-intent-service.js');

function seed() {
  recordedFacts.length = 0;
  rows.set(getTableName(combatEncounters), [
    { ...encounter, currentParticipantId: scholar.id, currentRound: 1 },
  ]);
  rows.set(getTableName(combatParticipants), structuredClone([scholar, golem]));
  rows.set(getTableName(tacticalMaps), [
    { id: 'map-row-1', sessionId: encounter.sessionId, active: true, state: buildMap() },
  ]);
}

describe('damage-scale wiring (#2534)', () => {
  beforeEach(seed);

  test('1 damage vs 10 max HP: scratch cue in the engine line and scratch in the DM fact', async () => {
    approachResult = { movementOnly: false, attackType: 'melee' };
    await executeCombatIntent(
      encounter.id,
      { type: 'attack', actorId: scholar.id, targetId: golem.id, weaponId: 'quarterstaff' },
      'user-1',
      'dm',
      undefined,
      'typed',
    );
    expect(recordedFacts).toHaveLength(1);
    const [, text, fact] = recordedFacts[0];
    expect(text).toContain('Damage scale cue: scratch (<25%');
    expect(fact.damageScale).toBe('scratch');
    expect(fact.kind).toBe('attack');
  });

  test('movement-only: the DM fact carries no damage scale', async () => {
    approachResult = { movementOnly: false, attackType: 'melee' };
    attackResolution = { resolvedAs: 'movement_only', targetId: golem.id };
    const result = await executeCombatIntent(
      encounter.id,
      { type: 'attack', actorId: scholar.id, targetId: golem.id, weaponId: 'quarterstaff' },
      'user-1',
      'dm',
      undefined,
      'typed',
    );
    expect(recordedFacts).toHaveLength(1);
    const [, , fact] = recordedFacts[0];
    expect(fact.kind).toBe('move');
    expect(fact.damageScale).toBeUndefined();
  });
});
