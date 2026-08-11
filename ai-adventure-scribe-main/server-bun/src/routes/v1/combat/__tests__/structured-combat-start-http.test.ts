/* eslint-disable max-lines -- one cohesive HTTP contract and its local dependency seams. */
import { beforeEach, describe, expect, it } from 'bun:test';

import type { SceneSpec } from '../../../../tactical/types.js';

// Route imports load the real env/db modules. Supplying harmless test-only values keeps the
// module link honest without replacing either module for the rest of the Bun process.
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://test:test@localhost:5432/test',
  PORT: process.env.PORT ?? '3000',
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? 'test-workos-key',
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? 'test-workos-client',
});

/**
 * HTTP contract tests for the structured combat-start bridge.
 *
 * This suite used to install process-wide `mock.module` replacements for the database,
 * combat services, and tactical map store. Bun keeps those replacements for later files in
 * the same process, so the otherwise independent combat suites received the wrong route
 * dependencies. The route factory makes the seam explicit: this test owns its fakes without
 * changing the process module graph, while service tests cover the database-bound leaves.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const CHARACTER_ID = '99999999-8888-4777-8666-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee';

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

type TestParticipant = Record<string, unknown> & {
  id: string;
  name: string;
  participantType: string;
  initiative: number;
  initiativeModifier: number;
};

const warnings: Array<Record<string, unknown>> = [];
const errorLogs: Array<Record<string, unknown>> = [];
const savedMaps: Array<Record<string, unknown>> = [];
const broadcasts: Array<Record<string, unknown>> = [];
let failStart = false;
let failMap = false;

const participant = (input: Record<string, unknown>, index: number): TestParticipant => {
  const monsterId = typeof input.monsterId === 'string' ? input.monsterId : undefined;
  const isPlayer = typeof input.characterId === 'string';
  const name = String(input.name ?? `Combatant ${index + 1}`);
  const isBandit = monsterId === 'srd:bandit';
  const isUnknownMonster = Boolean(monsterId) && !isBandit;
  const participantType = isPlayer ? 'player' : monsterId ? 'monster' : 'other';
  // The SRD resolver owns a catalog monster's modifier; the bridge's placeholder is not
  // authoritative for that participant.
  const initiativeModifier = isBandit ? 1 : Number(input.initiativeModifier ?? (isPlayer ? 3 : 0));
  const result: TestParticipant = {
    id: `participant-${index + 1}`,
    encounterId: ENCOUNTER_ID,
    characterId: isPlayer ? String(input.characterId) : null,
    npcId: null,
    name,
    initiative: isPlayer ? 16 : 11,
    initiativeModifier,
    turnOrder: index,
    isActive: true,
    createdAt: new Date('2026-07-24T00:00:00Z'),
    updatedAt: new Date('2026-07-24T00:00:00Z'),
    participantType,
    armorClass: isBandit || isUnknownMonster || !isPlayer ? 12 : 10,
    maxHp: isBandit ? 3 : isPlayer ? Number(input.hpMax ?? 24) : 11,
    speed: 30,
    resourcesRound: 0,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    isDodging: false,
    isDisengaged: false,
  };
  if (isBandit) {
    result.monsterAttack = {
      partyScaling: { rawMaxHp: 11, partySize: 1 },
    };
  }
  if (isUnknownMonster) {
    warnings.push({ monsterId, combatantName: name });
  }
  return result;
};

const makeCombatState = (inputs: readonly Record<string, unknown>[]) => {
  const participants = inputs.map(participant);
  return {
    encounter: {
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
    },
    participants,
    participantSizes: Object.fromEntries(participants.map((item) => [item.id, 'medium'])),
    turnOrder: participants.map((item, index) => ({
      participant: item,
      isCurrent: index === 0,
      hasGone: false,
    })),
    currentParticipant: participants[0] ?? null,
  };
};

const authenticateRequest = async (request: Request) =>
  request.headers.get('authorization') === 'Bearer valid-token'
    ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
    : { user: null, error: 'Unauthorized' };

const verifySessionOwnership = async (sessionId: string | undefined, _userId: string) =>
  sessionId === SESSION_ID
    ? { success: true as const, session: { id: SESSION_ID } }
    : { success: false as const, error: { status: 404, message: 'Session not found' } };

const verifyEncounterOwnership = async (_encounterId: string | undefined, _userId: string) => ({
  success: true as const,
  session: { id: SESSION_ID },
});

const sanitizeSceneSpec = (raw: unknown, sessionId: string) => {
  const input = raw as Record<string, unknown>;
  const environment = input?.environment;
  if (typeof environment !== 'string' || environment === 'space_station') {
    return {
      ok: false as const,
      detail: 'sceneSpec.environment must be one of: dungeon_room, cave, tavern',
    };
  }
  return {
    ok: true as const,
    sceneSpec: {
      sessionId,
      environment: environment as SceneSpec['environment'],
      size: 'medium' as const,
      enemyPlacement: 'ambush' as const,
      seed: 12345,
      sceneDescription: String(input.sceneDescription ?? ''),
    },
    overrides: ['sessionId', 'id'],
  };
};

const buildInitiativeOrder = (state: {
  turnOrder?: Array<{
    participant: TestParticipant;
    isCurrent: boolean;
    hasGone: boolean;
  }>;
}) =>
  (state.turnOrder ?? []).map((entry) => ({
    id: entry.participant.id,
    name: entry.participant.name,
    participantType: entry.participant.participantType,
    initiative: entry.participant.initiative,
    isCurrent: entry.isCurrent,
    hasGone: entry.hasGone,
  }));

const combatEncounterService = {
  getActiveEncounter: async () => null,
  getCombatState: async () => makeCombatState([]),
  startCombat: async (_sessionId: string, inputs: readonly Record<string, unknown>[]) => {
    if (failStart) throw new Error('relation "combat_encounters" does not exist');
    return makeCombatState(inputs);
  },
  getEncounterById: async () => null,
};

const logger = {
  debug: () => {},
  info: () => {},
  warn: (entry: Record<string, unknown>) => warnings.push(entry),
  error: (entry: Record<string, unknown>) => errorLogs.push(entry),
  child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
};

const createTacticalCombatMap = async (
  sessionId: string,
  _participants: readonly unknown[],
  scene: SceneSpec,
) => {
  if (failMap) throw new Error('tactical map write failed');
  const map = { id: `map-${savedMaps.length + 1}`, sessionId, ...scene };
  savedMaps.push(map);
  broadcasts.push({ type: 'map_created', sessionId });
};

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { createInitiativeRoutes } = await import('../initiative.js');
const { buildStructuredCombatStartPayload } =
  await import('../../../../../../src/services/combat/structured-combat-payload');

const app = createRequestPipelineApp().use(
  createInitiativeRoutes({
    authenticateRequest,
    verifyEncounterOwnership: verifyEncounterOwnership as never,
    verifySessionOwnership: verifySessionOwnership as never,
    logger: logger as never,
    combatEncounterService: combatEncounterService as never,
    trackCombatEvent: () => {},
    publishCombatState: async () => {},
    buildInitiativeOrder: buildInitiativeOrder as never,
    sanitizeSceneSpec: sanitizeSceneSpec as never,
    createTacticalCombatMap: createTacticalCombatMap as never,
  } as never),
);

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

/** The browser/CLI bridge derives the request; this test never hand-writes participants. */
const bridgePayload = (envelope: unknown = DM_ENVELOPE, character: unknown = CHARACTER) =>
  buildStructuredCombatStartPayload(
    character as Record<string, unknown>,
    envelope as Parameters<typeof buildStructuredCombatStartPayload>[1],
  );

beforeEach(() => {
  failStart = false;
  failMap = false;
  savedMaps.length = 0;
  broadcasts.length = 0;
  warnings.length = 0;
  errorLogs.length = 0;
});

describe('structured combat start — verbatim production envelope', () => {
  it('accepts the exact DM envelope through the client bridge and creates a map', async () => {
    const response = await startCombat(bridgePayload());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.error).toBeUndefined();
    expect(errorLogs).toEqual([]);
    expect(savedMaps).toHaveLength(1);
    expect(broadcasts.some((event) => event.type === 'map_created')).toBe(true);
  });

  it('returns the whole initiative order, monsters included, not just the PC', async () => {
    const response = await startCombat(bridgePayload());
    const body = (await response.json()) as {
      initiativeOrder: Array<{
        name: string;
        initiative: number;
        participantType: string;
        isCurrent: boolean;
      }>;
    };

    expect(response.status).toBe(201);
    expect(body.initiativeOrder.map((entry) => entry.name).sort()).toEqual([
      'Aggressive Patron',
      'Rook',
    ]);
    expect(body.initiativeOrder.every((entry) => typeof entry.initiative === 'number')).toBe(true);
    expect(body.initiativeOrder.filter((entry) => entry.isCurrent)).toHaveLength(1);
    expect(body.initiativeOrder.some((entry) => entry.participantType === 'monster')).toBe(true);
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
    expect(bandit).toMatchObject({
      participantType: 'monster',
      armorClass: 12,
      maxHp: 3,
      initiativeModifier: 1,
      speed: 30,
    });
    expect(
      (bandit!.monsterAttack as { partyScaling?: { rawMaxHp: number; partySize: number } })
        .partyScaling,
    ).toMatchObject({ rawMaxHp: 11, partySize: 1 });
    expect(body.participantSizes[String(bandit!.id)]).toBe('medium');
    expect(warnings).toEqual([]);
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
    expect(await response.json()).toMatchObject({
      stage: 'ownership',
      detail: 'sessionId must be a uuid',
    });
  });

  it('returns 404 with stage "ownership" for a session the caller does not own', async () => {
    const response = await startCombat(bridgePayload(), '00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Session not found', stage: 'ownership' });
  });

  it('reports stage "participants" with a 500 and logs the full error when persistence throws', async () => {
    failStart = true;
    const response = await startCombat(bridgePayload());
    const body = (await response.json()) as { error: string; stage: string; detail: string };

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: 'Failed to start combat encounter',
      stage: 'participants',
    });
    expect(body.detail).toContain('does not exist');
    expect(errorLogs).toHaveLength(1);
    expect(errorLogs[0]).toMatchObject({ msg: 'Start combat error', stage: 'participants' });
    const logged = errorLogs[0].error as Error;
    expect(logged.message).toContain('does not exist');
    expect(typeof logged.stack).toBe('string');
  });

  it('reports stage "map_generation" with a 500 when the map cannot be persisted', async () => {
    failMap = true;
    const response = await startCombat(bridgePayload());
    const body = (await response.json()) as { stage: string; detail: string };

    expect(response.status).toBe(500);
    expect(body.stage).toBe('map_generation');
    expect(body.detail).toContain('tactical map write failed');
    expect(errorLogs.at(-1)).toMatchObject({ stage: 'map_generation' });
  });
});
