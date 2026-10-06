import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import {
  deathSaveIntentWire,
  deathSaveIntentWireAutoRolled,
} from '../../../../../../shared/test-fixtures/death-save-intent';
import { vitalStateOf } from '../../../../services/combat/vital-state.js';

/**
 * The dying player's death saving throw, from the client's own bridge to the real route and the
 * real dispatch (#2518, AGENTS.md §4).
 *
 * The body the client sends is a shared fixture: the client test asserts the client sends exactly
 * it, and this one posts the client's real `executeStructuredCombatActionWithBoundary` output
 * through the real intent schema and the real `executeCombatIntent`. Only the database-bound
 * leaves are faked: the HP service roll, the initiative advance and the encounter read.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SCHOLAR_ID = '77777777-5555-4666-8777-888888888888';
const SPIDER_ID = '99999999-1111-4222-8333-444444444444';
const ENCOUNTER_VERSION = 3;

type Participant = ReturnType<typeof participant>;
const participant = (
  id: string,
  name: string,
  participantType: 'player' | 'monster',
  status: {
    currentHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  },
) => ({
  id,
  name,
  participantType,
  isActive: true,
  maxHp: 7,
  armorClass: 11,
  encounterId: ENCOUNTER_ID,
  actionUsed: false,
  status,
});

/** The Scholar on the floor, mid-round: 0/7, unconscious, one save banked. */
const dyingScholar = () =>
  participant(SCHOLAR_ID, 'The Scholar', 'player', {
    currentHp: 0,
    isConscious: false,
    deathSavesSuccesses: 1,
    deathSavesFailures: 0,
  });
const spider = () =>
  participant(SPIDER_ID, 'Vitruvian Spider', 'monster', {
    currentHp: 30,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  });

let currentId = SCHOLAR_ID;
const savesRolled: Array<{ actorId: string; d20?: number }> = [];
const turnsAdvanced: number[] = [];

const stateNow = () => {
  const participants: Participant[] = [dyingScholar(), spider()];
  return {
    encounter: {
      id: ENCOUNTER_ID,
      sessionId: SESSION_ID,
      status: 'active',
      version: ENCOUNTER_VERSION,
      currentRound: 4,
    },
    participants: participants.map((entry) => ({
      ...entry,
      vitalState: vitalStateOf(entry as never),
    })),
    turnOrder: [],
    currentParticipant: participants.find((entry) => entry.id === currentId) ?? null,
    participantSizes: {},
  };
};

mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  },
  combatLogger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module(import.meta.resolve('../helpers.js'), () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
  verifyEncounterOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
}));
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => stateNow(),
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    endCombat: async () => {},
  },
}));
mock.module('../../../../services/combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    advanceTurn: async () => {
      turnsAdvanced.push(1);
      currentId = SPIDER_ID;
      return {
        previousParticipant: dyingScholar(),
        currentParticipant: spider(),
        newRound: false,
        roundNumber: 4,
      };
    },
  },
}));
// The module under test's own pieces stay real except the two that touch the database.
mock.module('../../../../services/combat/death-saves-service.js', () => ({
  describeGoingDown: () => '',
  settleDownedTurns: async (
    _encounterId: string,
    _sessionId: string,
    _userId: string,
    turn: unknown,
  ) => ({
    turn,
    awaitingDeathSave: false,
  }),
  rollOwedDeathSave: async (
    _encounterId: string,
    _sessionId: string,
    _userId: string,
    actorId: string,
    d20?: number,
  ) => {
    savesRolled.push({ actorId, d20 });
    return {
      participantId: actorId,
      roll: d20 ?? 11,
      isSuccess: (d20 ?? 11) >= 10,
      isCritical: false,
      successes: 2,
      failures: 0,
      isStabilized: false,
      isDead: false,
      wasRevived: false,
      newCurrentHp: 0,
    };
  },
  planStableWake: async () => [],
  applyStableWake: async () => [],
  vitalStateOf,
}));
mock.module('../../../../services/combat/combat-attack-service.js', () => ({
  CombatAttackService: class {},
}));
mock.module('../../../../services/combat/data-access.js', () => ({
  listEquippedWeaponProfiles: async () => [],
  getEquippedWeaponProfile: async () => ({}),
  getParticipantAbilityProfile: async () => ({ scores: {}, level: 1, spellIds: [] }),
  getActiveConditionNames: async () => [],
  verifyEncounterAccess: async () => {},
}));
mock.module('../../../../services/combat/combat-approach-service.js', () => ({
  decideAttackApproach: async () => ({ movementOnly: false, attackType: 'melee' }),
  describeResolvedAttack: () => '',
}));
mock.module('../../../../services/combat/tactical-action-service.js', () => ({
  recordDmTacticalFact: async () => {},
  applyTacticalMapAction: async () => ({ applied: true }),
}));
mock.module('../../../../services/combat/tactical-combat-lifecycle.js', () => ({
  destroyTacticalCombatMap: async () => {},
  grantTacticalDash: async () => ({ applied: true }),
  resetTacticalMovementForTurn: async () => {},
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  loadLatestTacticalMapRow: async () => null,
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../../services/combat/combat-events.js', () => ({
  trackCombatEvent: () => {},
}));
mock.module('../../../../../../src/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({ authorization: 'Bearer valid-token' }),
  configureHeadlessSession: () => {},
  loadCachedSession: () => null,
  persistSession: () => {},
  refreshAccessTokenOnce: async () => null,
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');
/** Imported by specifier, as in the sibling suites: the frontend graph stays out of the server tsconfig. */
const bridgeModule = '../../../../../../src/services/combat/combat-action-executor';
const { executeStructuredCombatActionWithBoundary } = (await import(bridgeModule)) as {
  executeStructuredCombatActionWithBoundary(
    encounterId: string,
    action: Record<string, unknown>,
    providedD20?: number,
    origin?: string,
  ): Promise<{ result?: Record<string, any>; boundary: string | null }>;
};

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

const sentRequests: Array<{ url: string; body: any }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  sentRequests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  return app.handle(new Request(url, init));
}) as typeof globalThis.fetch;

const postIntent = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: JSON.stringify(body),
    }),
  );

const deathSaveAction = {
  actor_id: SCHOLAR_ID,
  action_type: 'death_save',
  target_ids: [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

beforeEach(() => {
  currentId = SCHOLAR_ID;
  savesRolled.length = 0;
  turnsAdvanced.length = 0;
  sentRequests.length = 0;
});

describe('the dying player’s death save through the client bridge and the real route', () => {
  it('sends exactly the shared wire body, and the engine is handed the die the player rolled', async () => {
    const execution = await executeStructuredCombatActionWithBoundary(
      ENCOUNTER_ID,
      deathSaveAction,
      14,
      'dice_roll',
    );

    const { dmStartedAt, ...sent } = sentRequests[0].body;
    expect(typeof dmStartedAt).toBe('number');
    expect(sent).toEqual(deathSaveIntentWire(SCHOLAR_ID, 14));
    expect(savesRolled).toEqual([{ actorId: SCHOLAR_ID, d20: 14 }]);
    // One save, and the save was the whole turn: the order moved on to the spider.
    expect(execution.result?.deathSaves).toHaveLength(1);
    expect(execution.result?.deathSaves[0]).toMatchObject({ roll: 14, isSuccess: true });
    expect(turnsAdvanced).toHaveLength(1);
    expect(execution.result?.currentParticipant?.id).toBe(SPIDER_ID);
    expect(execution.boundary).toBeNull();
  });

  it('an auto-rolled prompt sends no die, and the engine rolls it', async () => {
    await executeStructuredCombatActionWithBoundary(
      ENCOUNTER_ID,
      deathSaveAction,
      undefined,
      'dice_roll',
    );

    const { dmStartedAt: _clock, ...sent } = sentRequests[0].body;
    expect(sent).toEqual(deathSaveIntentWireAutoRolled(SCHOLAR_ID));
    expect(savesRolled).toEqual([{ actorId: SCHOLAR_ID, d20: undefined }]);
  });

  it('a death save the DM produced (origin dm) is refused: the die is the player’s', async () => {
    const response = await postIntent({
      intent: { type: 'death_save', actorId: SCHOLAR_ID, d20: 20 },
      source: 'dm',
      origin: 'dm',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      details: { reason: 'player_action_without_input', origin: 'dm' },
    });
    expect(savesRolled).toHaveLength(0);
  });

  it('a typed action for the dying player is refused with the reason, not run', async () => {
    const response = await postIntent({
      intent: { type: 'dash', actorId: SCHOLAR_ID },
      source: 'dm',
      origin: 'typed',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'A downed character cannot act',
      details: { reason: 'actor_unconscious' },
    });
    expect(turnsAdvanced).toHaveLength(0);
  });

  it('ending a dying player’s turn without the save is refused: the save is owed', async () => {
    const response = await postIntent({
      intent: { type: 'end_turn', actorId: SCHOLAR_ID },
      source: 'dm',
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ details: { reason: 'death_save_required' } });
    expect(turnsAdvanced).toHaveLength(0);
  });
});
