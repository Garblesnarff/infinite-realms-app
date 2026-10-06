import { describe, expect, mock, test } from 'bun:test';
import { getTableColumns, getTableName, SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  campaigns,
  combatEncounters,
  combatParticipants,
  gameSessions,
  starterCampaigns,
  tacticalMaps,
} from '../../../../../db/schema/index.js';

import type { TacticalMap } from '../../../tactical/types.js';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';

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
  listEquippedWeaponProfiles: async () => [],
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
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../combat-attack-service.js', () => ({
  CombatAttackService: class {
    async resolveSpellAttack(): Promise<unknown> {
      return {
        results: [
          {
            spellName: 'Fire Bolt',
            d20: 17,
            attackBonus: 5,
            totalAttackRoll: 22,
            targetAC: 17,
            hit: true,
            finalDamage: 6,
            damageType: 'fire',
            targetNewHp: 10,
            targetIsConscious: true,
            targetIsDead: false,
          },
        ],
      };
    }
  },
}));

const { consumeDmTacticalFacts } = await import('../tactical-action-service.js');
const { executeCombatIntent } = await import('../combat-intent-service.js');

function seed(sessionRow: Row, campaignRows: Row[], starterRows: Row[] = []): void {
  rows.clear();
  rows.set(getTableName(combatEncounters), [
    { ...encounter, currentParticipantId: scholar.id, currentRound: 1 },
  ]);
  rows.set(getTableName(combatParticipants), structuredClone([scholar, golem]));
  rows.set(getTableName(tacticalMaps), [
    { id: 'map-row-1', sessionId: encounter.sessionId, active: true, state: buildMap() },
  ]);
  rows.set(getTableName(gameSessions), [sessionRow]);
  rows.set(getTableName(campaigns), campaignRows);
  rows.set(getTableName(starterCampaigns), starterRows);
}

async function castFireBolt(): Promise<string[]> {
  await executeCombatIntent(
    encounter.id,
    {
      type: 'spell',
      actorId: scholar.id,
      targetIds: [golem.id],
      spellName: 'Fire Bolt',
      expectedVersion: 1,
    },
    'user-1',
    'dm',
    undefined,
    'typed',
  );
  return consumeDmTacticalFacts(encounter.sessionId);
}

describe('spell narration target numbers at the combat-intent call site', () => {
  test('a Hard campaign hands the DM the spell outcome with no AC clause', async () => {
    seed({ id: 'session-1', campaignId: 'campaign-1', starterCampaignId: null }, [
      { id: 'campaign-1', difficultyLevel: 'hard' },
    ]);

    const facts = await castFireBolt();

    expect(facts).toEqual([
      'The Scholar cast Fire Bolt at Gravity Golem — spell attack 17 + 5 = 22 — HIT. 6 fire damage. Gravity Golem is now at 10 HP. Narrate this outcome; it already happened.',
    ]);
    expect(facts[0]).not.toContain('vs AC');
    expect(facts[0]).not.toContain('17 — HIT');
  });

  test('an Easy campaign hands the DM the spell outcome with the AC clause', async () => {
    seed({ id: 'session-1', campaignId: 'campaign-1', starterCampaignId: null }, [
      { id: 'campaign-1', difficultyLevel: 'easy' },
    ]);

    const facts = await castFireBolt();

    expect(facts).toEqual([
      'The Scholar cast Fire Bolt at Gravity Golem — spell attack 17 + 5 = 22 vs AC 17 — HIT. 6 fire damage. Gravity Golem is now at 10 HP. Narrate this outcome; it already happened.',
    ]);
  });

  test('a Hard starter campaign hides the clause too', async () => {
    seed(
      { id: 'session-1', campaignId: null, starterCampaignId: 'starter-1' },
      [],
      [{ id: 'starter-1', difficulty: 'hard' }],
    );

    const facts = await castFireBolt();

    expect(facts).toHaveLength(1);
    expect(facts[0]).not.toContain('vs AC');
  });
});
