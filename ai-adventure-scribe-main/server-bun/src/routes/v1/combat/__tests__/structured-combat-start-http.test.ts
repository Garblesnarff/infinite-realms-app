/* eslint-disable max-lines -- one cohesive reproduction: the incident envelope plus every
   failure mode of the start pipeline, sharing a single module-mock setup. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';

import { createFakePostgresClient, type FakeQueryHandler } from './fake-postgres-client.js';
import * as schema from '../../../../../../db/schema/index';

/**
 * HTTP-level reproduction of the production combat-start failure.
 *
 * The verbatim DM envelope from the incident is fed through the SAME client bridge the
 * browser and CLI use, then into the real start endpoint over a real Drizzle instance with
 * only the postgres wire faked. Before the fix this returned 500 in single-digit
 * milliseconds with the exception erased by the logger; the first test below is the guard
 * that keeps it honest.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const CHARACTER_ID = '99999999-8888-4777-8666-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

/** The exact envelope captured in production, byte for byte. */
const DM_ENVELOPE = {
  text: 'Seeing the imminent danger, you draw your longsword and step forward, your posture hardening as you challenge the threat ahead. The air in the restaurant grows heavy with expectation as you intentionally provoke a confrontation, ensuring this shift is anything but routine.',
  combat_transition: 'start',
  scene_spec: {
    id: 'main_floor_confrontation',
    sessionId: 'eternal_feast_01',
    environment: 'tavern',
    size: 'medium',
    sceneDescription:
      'The main dining room of the Eternal Feast, where the floorboards creak rhythmically and tables adjust to the tension of the brewing fight.',
    seed: 12345,
    enemyPlacement: 'ambush',
  },
  combatants: [{ monster_id: 'srd:bandit', name: 'Aggressive Patron', count: 1 }],
  roll_requests: [
    {
      type: 'initiative',
      formula: '1d20+3',
      purpose: 'Initiative roll for the start of combat',
      dc: null,
      ac: null,
      advantage: false,
      disadvantage: false,
    },
  ],
  map_actions: [],
} as const;

const CHARACTER = {
  id: CHARACTER_ID,
  name: 'Rook',
  abilityScores: { dexterity: { score: 16, modifier: 3 } },
  currentHitPoints: 24,
  maxHitPoints: 24,
};

const columnNames = (table: unknown): string[] =>
  Object.keys(getTableColumns(table as never));

const encounterRow = {
  id: ENCOUNTER_ID,
  sessionId: SESSION_ID,
  status: 'active',
  currentRound: 1,
  currentTurnOrder: 0,
  version: 1,
  location: null,
  difficulty: null,
  experienceAwarded: null,
  startedAt: new Date('2026-07-24T00:00:00Z'),
  endedAt: null,
  createdAt: new Date('2026-07-24T00:00:00Z'),
  updatedAt: new Date('2026-07-24T00:00:00Z'),
};

const camelCase = (column: string): string =>
  column.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

/** Splits a SQL `values (...), (...)` clause into its parenthesised tuples. */
const valueTuples = (sql: string): string[][] => {
  const clause = sql.slice(sql.toLowerCase().indexOf(') values (') + 8);
  return [...clause.matchAll(/\(([^()]*)\)/g)].map((match) =>
    match[1].split(',').map((item) => item.trim()),
  );
};

/**
 * `insert ... returning` echoes back what the service asked to persist, which is what lets
 * these tests assert on resolved SRD stats instead of on a canned fixture.
 *
 * Both the column list and the `$n` placeholder positions are read out of the generated SQL:
 * Drizzle emits every table column (using `default` for the ones the service omitted) in
 * table-definition order, so any hand-written column list silently shuffles asserted values.
 */
const echoInsertedParticipants = (
  params: readonly unknown[],
  sql: string,
): Array<Record<string, unknown>> => {
  const columns = (/insert into "combat_participants" \(([^)]*)\)/i.exec(sql)?.[1] ?? '')
    .split(',')
    .map((column) => camelCase(column.trim().replace(/"/g, '')));

  return valueTuples(sql).map((tuple, rowIndex) => {
    const row: Record<string, unknown> = {
      id: `participant-${rowIndex + 1}`,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      isDodging: false,
      isDisengaged: false,
      multiclassInfo: null,
      createdAt: encounterRow.createdAt,
      updatedAt: encounterRow.updatedAt,
    };
    tuple.forEach((item, index) => {
      const placeholder = /^\$(\d+)$/.exec(item);
      if (placeholder) row[columns[index]] = params[Number(placeholder[1]) - 1];
    });
    // postgres.js parses `text[]` back into a JS array; the fake hands back real arrays.
    for (const arrayColumn of ['damageResistances', 'damageImmunities', 'damageVulnerabilities']) {
      row[arrayColumn] = [];
    }
    return row;
  });
};

const handlers = (): FakeQueryHandler[] => [
  {
    match: /^insert into "combat_encounters"/i,
    columns: columnNames(schema.combatEncounters),
    rows: () => [encounterRow],
  },
  {
    match: /^insert into "combat_participants"/i,
    columns: columnNames(schema.combatParticipants),
    rows: echoInsertedParticipants,
  },
  {
    match: /^insert into "combat_participant_status"/i,
    columns: columnNames(schema.combatParticipantStatus),
    rows: () => [],
  },
  {
    match: /^select .* from "characters"/i,
    columns: [...columnNames(schema.characters), ...columnNames(schema.characterStats)],
    rows: () => [],
  },
  { match: /^select/i, columns: [], rows: () => [] },
];

// One client, one Drizzle instance: `mock.module` needs a stable binding, so tests swap
// `activeHandlers` instead of rebuilding the client.
let activeHandlers = handlers();
const fakeClient = createFakePostgresClient(() => activeHandlers);
const savedMaps: unknown[] = [];
const broadcasts: unknown[] = [];
const warnings: Array<Record<string, unknown>> = [];
const errorLogs: Array<Record<string, unknown>> = [];

const db = drizzle(fakeClient as never, { schema });
mock.module('../../../../../../db/client', () => ({ db }));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: (entry: Record<string, unknown>) => warnings.push(entry),
    error: (entry: Record<string, unknown>) => errorLogs.push(entry),
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
}));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module('../helpers.js', () => ({
  verifySessionOwnership: async (sessionId: string) =>
    sessionId === SESSION_ID
      ? { success: true, session: { id: SESSION_ID } }
      : { success: false, error: { status: 404, message: 'Session not found' } },
  verifyEncounterOwnership: async () => ({ success: true }),
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  saveTacticalMap: async (map: unknown) => {
    savedMaps.push(map);
  },
  deactivateTacticalMap: async () => {},
}));
mock.module('../../../../services/collaboration/room-manager.js', () => ({
  broadcastToRoom: (_sessionId: string, _sender: unknown, payload: unknown) => {
    broadcasts.push(payload);
  },
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../../services/combat/combat-events.js', () => ({
  trackCombatEvent: () => {},
}));
// Authorization is verified twice over (route helper + atomic INSERT ... SELECT); the unit
// under test here is the start pipeline, so the batch pre-checks are stubbed wholesale.
mock.module('../../../../services/combat/combat-authorization.js', () => ({
  verifySessionAccess: async () => {},
  verifyEncounterAccess: async () => {},
  verifyCharacterAccess: async () => {},
  verifyCharactersAccessBatch: async () => {},
  verifyNPCAccess: async () => {},
  verifyNPCsAccessBatch: async () => {},
  verifyParticipantOwnership: async () => {},
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { initiativeRoutes } = await import('../initiative.js');
const { buildStructuredCombatStartPayload } = await import(
  '../../../../../../src/services/combat/structured-combat-payload'
);

const app = createRequestPipelineApp().use(initiativeRoutes);

const startCombat = (body: unknown, sessionId = SESSION_ID, authorized = true) =>
  app.handle(
    new Request(`http://localhost/sessions/${sessionId}/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { authorization: 'Bearer valid-token' } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/** The exact payload the browser/CLI bridge derives from the envelope. Never hand-written. */
const bridgePayload = (envelope: unknown = DM_ENVELOPE, character: unknown = CHARACTER) =>
  buildStructuredCombatStartPayload(
    character as Record<string, unknown>,
    envelope as Parameters<typeof buildStructuredCombatStartPayload>[1],
  );

beforeEach(() => {
  activeHandlers = handlers();
  fakeClient.queries.length = 0;
  savedMaps.length = 0;
  broadcasts.length = 0;
  warnings.length = 0;
  errorLogs.length = 0;
});

describe('structured combat start — verbatim production envelope', () => {
  it('accepts the exact DM envelope through the client bridge and creates a map', async () => {
    const payload = bridgePayload();
    const response = await startCombat(payload);
    const body = (await response.json()) as Record<string, never>;

    expect(response.status).toBe(201);
    expect(body.error).toBeUndefined();
    expect(errorLogs).toEqual([]);
    expect(savedMaps).toHaveLength(1);
    expect(broadcasts.some((event) => (event as { type?: string }).type === 'map_created')).toBe(
      true,
    );
  });

  it('threads monster_id through the bridge so the server resolves the SRD stat block', async () => {
    const payload = bridgePayload();
    expect(payload?.participants[1]).toMatchObject({
      name: 'Aggressive Patron',
      monsterId: 'srd:bandit',
    });

    const response = await startCombat(payload);
    const body = (await response.json()) as {
      participants: Array<Record<string, unknown>>;
      participantSizes: Record<string, string>;
    };

    expect(response.status).toBe(201);
    const bandit = body.participants.find((p) => p.name === 'Aggressive Patron');
    // srd:bandit — AC 12, 11 hp, DEX 12 (+1), 30 ft. Not the 10/10/30 placeholder.
    expect(bandit).toMatchObject({
      participantType: 'monster',
      armorClass: 12,
      maxHp: 11,
      initiativeModifier: 1,
      speed: 30,
    });
    expect(body.participantSizes[String(bandit!.id)]).toBe('medium');
    expect(warnings).toEqual([]);

    // The PC's client-computed DEX modifier survives instead of being zeroed.
    expect(body.participants.find((p) => p.name === 'Rook')).toMatchObject({
      participantType: 'player',
      initiativeModifier: 3,
    });
  });

  it('overrides the model-invented scene_spec sessionId with the route parameter', async () => {
    expect(DM_ENVELOPE.scene_spec.sessionId).toBe('eternal_feast_01');

    const response = await startCombat(bridgePayload());
    expect(response.status).toBe(201);

    const map = savedMaps[0] as { sessionId: string; id: string };
    expect(map.sessionId).toBe(SESSION_ID);
    // The model's `id` is a suggestion only; the server mints the tactical map key.
    expect(map.id).not.toBe('main_floor_confrontation');
  });

  it('falls back to generic NPC stats for a name-only combatant', async () => {
    const payload = bridgePayload({
      ...DM_ENVELOPE,
      combatants: [{ name: 'Angry Cook', count: 1 }],
    });
    expect(payload?.participants[1].monsterId).toBeUndefined();

    const response = await startCombat(payload);
    const body = (await response.json()) as { participants: Array<Record<string, unknown>> };

    expect(response.status).toBe(201);
    expect(body.participants.find((p) => p.name === 'Angry Cook')).toMatchObject({
      participantType: 'other',
      armorClass: 12,
      maxHp: 11,
    });
    // Nothing was claimed to resolve, so nothing to warn about.
    expect(warnings).toEqual([]);
  });

  it('never falls back silently when a monster_id was supplied but did not resolve', async () => {
    const payload = bridgePayload({
      ...DM_ENVELOPE,
      combatants: [{ monster_id: 'srd:definitely-not-a-monster', name: 'Ghost Waiter', count: 1 }],
    });

    const response = await startCombat(payload);
    expect(response.status).toBe(201);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      monsterId: 'srd:definitely-not-a-monster',
      combatantName: 'Ghost Waiter',
    });
  });
});

describe('structured combat start — honest error bodies', () => {
  it('returns 422 with stage "participants" for an empty participants array', async () => {
    const response = await startCombat({ participants: [], sceneSpec: DM_ENVELOPE.scene_spec });
    const body = (await response.json()) as { error: string; stage: string; detail: string };
    expect(response.status).toBe(422);
    expect(body.error).toBe('Invalid combat start payload');
    expect(body.stage).toBe('participants');
    expect(body.detail).toContain('participants');
  });

  it('returns 422 with stage "map_generation" for an unusable scene environment', async () => {
    const payload = bridgePayload({
      ...DM_ENVELOPE,
      scene_spec: { ...DM_ENVELOPE.scene_spec, environment: 'space_station' },
    });
    const response = await startCombat(payload);
    const body = (await response.json()) as { stage: string; detail: string };

    expect(response.status).toBe(422);
    expect(body.stage).toBe('map_generation');
    expect(body.detail).toContain('sceneSpec.environment');
  });

  it('returns 422 with stage "ownership" for a non-uuid session id', async () => {
    const response = await startCombat(bridgePayload(), 'eternal_feast_01');
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ stage: 'ownership', detail: 'sessionId must be a uuid' });
  });

  it('returns 404 with stage "ownership" for a session the caller does not own', async () => {
    const response = await startCombat(bridgePayload(), '00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Session not found', stage: 'ownership' });
  });

  it('reports stage "participants" with a 500 and logs the full error when persistence throws', async () => {
    activeHandlers = [
      {
        match: /^insert into "combat_encounters"/i,
        columns: [],
        rows: () => {
          throw new Error('relation "combat_encounters" does not exist');
        },
      },
      ...handlers(),
    ];

    const response = await startCombat(bridgePayload());
    const body = (await response.json()) as { error: string; stage: string; detail: string };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: 'Failed to start combat encounter', stage: 'participants' });
    // Drizzle wraps driver errors; the reported detail carries the cause sentence through.
    expect(body.detail).toContain('does not exist');

    // The whole point of the logging fix: the route, not mapCombatError, is the witness.
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({ msg: 'Start combat error', stage: 'participants' });
    const logged = errorLogs[0].error as Error & { cause?: Error };
    expect(String(logged.cause?.message ?? logged.message)).toContain('does not exist');
    expect(typeof (errorLogs[0].error as Error).stack).toBe('string');
  });

  it('reports stage "map_generation" with a 500 when the map cannot be persisted', async () => {
    mock.module('../../../../services/combat/tactical-map-store.js', () => ({
      loadActiveTacticalMap: async () => null,
      saveTacticalMap: async () => {
        throw new Error('tactical map write failed');
      },
      deactivateTacticalMap: async () => {},
    }));
    // Cache-busting query so the route module re-binds the re-mocked tactical map store.
    const { initiativeRoutes: freshRoutes } = (await import(
      '../initiative.js?map-failure' as string
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic re-import
    )) as typeof import('../initiative.js');
    const freshApp = createRequestPipelineApp().use(freshRoutes);

    const response = await freshApp.handle(
      new Request(`http://localhost/sessions/${SESSION_ID}/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
        body: JSON.stringify(bridgePayload()),
      }),
    );
    const body = (await response.json()) as { stage: string; detail: string };

    expect(response.status).toBe(500);
    expect(body.stage).toBe('map_generation');
    expect(body.detail).toContain('tactical map write failed');
    expect(errorLogs.at(-1)).toMatchObject({ stage: 'map_generation' });
  });
});
