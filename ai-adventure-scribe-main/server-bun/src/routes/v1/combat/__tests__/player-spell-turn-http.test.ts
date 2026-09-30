/* eslint-disable max-lines -- two production replays through one real route and one real client
   resolution step, sharing a single mock setup. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type { MapEntity, TacticalMap } from '../../../../tactical/types.js';

/**
 * Two production replays, driven through the real intent route and the real client resolution
 * step that calls it (#2303, #2305). Only the DB-facing services and the LLM are stubbed.
 *
 * Run 13 (#2303): "…I cast Chill Touch at it" entered combat. The spell proposal answered 500 —
 * `proposeCombatSpell` called a `resolveIntentRefs` that #2250 had moved away, a ReferenceError
 * the route mapped to a bare, unlogged 500 — so no popup opened and the engine rolled the die.
 * The commit then answered 404 because the DM addressed the spider by its catalog key
 * `srd:vitruvian-spider`, and the repair re-declared the cast: REFUSED and HIT for one cast.
 *
 * Run M7 round 2 (#2305): a generate the player never started carried a player-actor cast, and
 * the engine resolved it — with participant UUIDs, the shape asserted below.
 */
const SESSION_ID = '235c24e4-f776-43fa-8f70-4b8478317953';
const ENCOUNTER_ID = 'e570e444-197c-43c9-a43b-edbd61e11792';
const SCHOLAR_ID = '465816e1-0000-4000-8000-000000000001';
const SPIDER_ID = '779792b2-0000-4000-8000-000000000002';
const ENCOUNTER_VERSION = 3;

const participant = (id: string, name: string, participantType: 'player' | 'npc') => ({
  id,
  name,
  participantType,
  isActive: true,
  maxHp: 11,
  armorClass: participantType === 'npc' ? 15 : 11,
  encounterId: ENCOUNTER_ID,
  status: { currentHp: 11 },
});
const SCHOLAR = participant(SCHOLAR_ID, 'The Scholar', 'player');
const SPIDER = participant(SPIDER_ID, 'The Vitruvian Spider', 'npc');

const entity = (id: string, name: string, x: number, type: 'pc' | 'monster') =>
  ({
    id,
    name,
    x,
    y: 1,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
  }) satisfies MapEntity;

type SpellInput = { casterId: string; targetIds: string[]; d20?: number; spellName: string };
const spellProposals: SpellInput[] = [];
const spellCommits: SpellInput[] = [];
const trackedEvents: Array<Record<string, unknown>> = [];
const serverLogs: Array<{ level: string; data: unknown; msg?: unknown }> = [];
const clientWarnings: Array<{ msg: unknown; data: unknown }> = [];
const narrationCalls: Array<Record<string, unknown>> = [];
let repairCalls = 0;
let proposeThrows: Error | null = null;

const serverLog = (level: string) => (data: unknown, msg?: unknown) => {
  serverLogs.push({ level, data, msg });
};
mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: serverLog('warn'),
    error: serverLog('error'),
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
// The seated encounter at the player's first turn: the spider has already moved.
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({
      encounter: {
        id: ENCOUNTER_ID,
        sessionId: SESSION_ID,
        status: 'active',
        version: ENCOUNTER_VERSION,
      },
      participants: [SCHOLAR, SPIDER],
      turnOrder: [],
      currentParticipant: SCHOLAR,
      participantSizes: {},
    }),
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    endCombat: async () => {},
  },
}));
mock.module('../../../../services/combat-initiative-service.js', () => ({
  CombatInitiativeService: class {
    static async advanceTurn() {
      return { currentParticipant: SPIDER, round: 1 };
    }
  },
}));
mock.module('../../../../services/combat/combat-attack-service.js', () => ({
  CombatAttackService: class {
    async proposeSpellAttack(_encounterId: string, input: SpellInput) {
      if (proposeThrows) throw proposeThrows;
      spellProposals.push(input);
      return {
        spellId: 'chill-touch',
        spellName: 'Chill Touch',
        kind: 'attack',
        attackBonus: 6,
        saveDC: 14,
        targetAc: 15,
        advantage: false,
        disadvantage: false,
      };
    }
    async resolveSpellAttack(_encounterId: string, input: SpellInput) {
      spellCommits.push(input);
      const d20 = input.d20 ?? 10;
      return {
        results: [
          {
            actorName: 'The Scholar',
            targetName: 'The Vitruvian Spider',
            spellName: 'Chill Touch',
            d20,
            attackBonus: 6,
            totalAttackRoll: d20 + 6,
            targetAC: 15,
            hit: true,
            finalDamage: 3,
            damageType: 'necrotic',
            targetNewHp: 8,
            targetIsDead: false,
            ...(input.d20 === undefined ? { autoRolled: true } : {}),
          },
        ],
      };
    }
  },
}));
mock.module('../../../../services/combat/data-access.js', () => ({
  listEquippedWeaponProfiles: async () => [],
  getEquippedWeaponProfile: async () => null,
  getParticipantAbilityProfile: async () => ({ scores: {}, level: 1, spellIds: ['chill-touch'] }),
  getActiveConditionNames: async () => [],
  verifyEncounterAccess: async () => {},
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
  loadActiveTacticalMap: async () => board(),
  loadLatestTacticalMapRow: async () => ({ rowId: 'row', state: board(), active: true }),
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));
mock.module('../../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../../services/combat/combat-events.js', () => ({
  trackCombatEvent: (name: string, payload: Record<string, unknown>) => {
    trackedEvents.push({ name, ...payload });
  },
}));

// ---- The client side: real resolution step and spell popup; only its edges are stubbed. ----
const CLIENT = '../../../../../../src';
mock.module(`${CLIENT}/services/auth/TokenService`, () => ({
  getAuthHeaders: () => ({ authorization: 'Bearer valid-token' }),
  configureHeadlessSession: () => {},
  loadCachedSession: () => null,
  persistSession: () => {},
  refreshAccessTokenOnce: async () => null,
}));
const clientLogger = {
  debug: () => {},
  info: () => {},
  error: () => {},
  warn: (msg: unknown, data?: unknown) => {
    clientWarnings.push({ msg, data });
  },
};
mock.module(`${CLIENT}/lib/logger`, () => ({ default: clientLogger, logger: clientLogger }));
mock.module(`${CLIENT}/services/ai-service`, () => ({
  AIService: {
    chatWithDM: async (request: { message: string }) => {
      narrationCalls.push(JSON.parse(request.message));
      return { text: 'A cold hand closes on the spider.', narrationSegments: [] };
    },
  },
  formatConversationHistoryMessage: (message: unknown) => message,
}));
mock.module(`${CLIENT}/services/combat/combat-repair`, () => ({
  repairRefusedCombatAction: async () => {
    repairCalls += 1;
    return null;
  },
}));
mock.module(`${CLIENT}/services/user-data-api`, () => ({
  userDataApi: {
    // The spider's next turn is out of scope: hand the turn straight back to the player.
    advanceNpcTurns: async () => ({
      results: [],
      currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar' },
      combatEnded: false,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    }),
  },
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');
const { assignEntitySlugs } = await import('../../../../tactical/identity.js');

/** Non-literal specifiers keep the client graph out of the server's tsconfig (see slug test). */
type ClientAction = {
  actor_id: string;
  action_type: 'cast_spell';
  target_ids: string[];
  weapon_id: null;
  spell_id: string;
  slot_level: null;
  movement_feet: number;
};
type RollHost = {
  present: (
    spec: Record<string, unknown>,
    settle: (outcome: { d20: number | null }) => void,
  ) => { rollId: string; dismiss: () => void };
};
const resolutionModule = `${CLIENT}/hooks/ai/combat-resolution-step`;
const { resolveDeclaredCombatActions } = (await import(resolutionModule)) as {
  resolveDeclaredCombatActions(params: Record<string, unknown>): Promise<{ text: string }>;
};
const rollBridgeModule = `${CLIENT}/services/combat/player-roll-bridge`;
const { setPlayerRollHost } = (await import(rollBridgeModule)) as {
  setPlayerRollHost(host: RollHost | null): void;
};

function board(): TacticalMap {
  const entities = [
    entity(SCHOLAR_ID, 'The Scholar', 1, 'pc'),
    entity(SPIDER_ID, 'The Vitruvian Spider', 4, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: SESSION_ID,
    width: 10,
    height: 10,
    round: 1,
    sceneDescription: 'the shaft',
    cells: Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => ({
        terrain: 'floor' as const,
        blocksMovement: false,
        blocksSight: false,
        cover: 0 as const,
        elevation: 0,
      })),
    ),
    entities,
  };
}

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

const exchanges: Array<{ url: string; body: Record<string, unknown>; status: number }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await app.handle(new Request(String(input), init));
  exchanges.push({
    url: String(input),
    body: init?.body ? JSON.parse(String(init.body)) : {},
    status: response.status,
  });
  return response;
}) as typeof globalThis.fetch;

const postIntent = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
        'x-request-id': 'req-2303',
      },
      body: JSON.stringify(body),
    }),
  );

/** The prompts the player was shown, answered with the die they rolled. */
const prompts: Array<Record<string, unknown>> = [];
const playerRolls = (d20: number): RollHost => ({
  present: (spec, settle) => {
    prompts.push(spec);
    settle({ d20 });
    return { rollId: `roll-${prompts.length}`, dismiss: () => {} };
  },
});

const PARTICIPANTS = [
  { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player', turnOrder: 1 },
  { id: SPIDER_ID, name: 'The Vitruvian Spider', participantType: 'npc', turnOrder: 0 },
];

const chillTouch = (actorId: string, targetId: string): ClientAction => ({
  actor_id: actorId,
  action_type: 'cast_spell',
  target_ids: [targetId],
  weapon_id: null,
  spell_id: 'chill-touch',
  slot_level: null,
  movement_feet: 0,
});

const resolveTurn = (action: ClientAction, playerInputOrigin: string | null) =>
  resolveDeclaredCombatActions({
    encounterId: ENCOUNTER_ID,
    sessionId: SESSION_ID,
    combatActions: [action],
    declarationText: 'I cast Chill Touch at it.',
    participants: PARTICIPANTS,
    aiContext: { sessionId: SESSION_ID, gameState: { isInCombat: true } },
    conversationHistory: [],
    combatRound: 1,
    playerInputOrigin,
  });

const intentExchanges = () => exchanges.filter((exchange) => exchange.url.endsWith('/intent'));

beforeEach(() => {
  spellProposals.length = 0;
  spellCommits.length = 0;
  trackedEvents.length = 0;
  serverLogs.length = 0;
  clientWarnings.length = 0;
  narrationCalls.length = 0;
  exchanges.length = 0;
  prompts.length = 0;
  repairCalls = 0;
  proposeThrows = null;
  setPlayerRollHost(null);
});

describe('run 13: the first spell at combat entry (#2303)', () => {
  it('proposes against the seated roster, translating the catalog ref the DM wrote', async () => {
    const response = await postIntent({
      intent: {
        type: 'spell',
        actorId: 'the-scholar',
        targetIds: ['srd:vitruvian-spider'],
        spellId: 'chill-touch',
        spellName: 'Chill Touch',
      },
      source: 'dm',
      phase: 'propose',
    });
    const body = (await response.json()) as { proposal: Record<string, unknown> };

    // Was 500 (ReferenceError), then 404 "Combat participant not found" on the commit.
    expect(response.status).toBe(200);
    expect(body.proposal).toMatchObject({
      spellName: 'Chill Touch',
      attackBonus: 6,
      targetAc: 15,
      actorId: SCHOLAR_ID,
      targetIds: [SPIDER_ID],
      targetLabel: 'The Vitruvian Spider',
    });
    expect(spellProposals).toEqual([
      expect.objectContaining({ casterId: SCHOLAR_ID, targetIds: [SPIDER_ID] }),
    ]);
  });

  it('replays the cast: no 5xx, one proposal, one player d20 prompt, one engine line', async () => {
    setPlayerRollHost(playerRolls(14));

    const result = await resolveTurn(chillTouch('the-scholar', 'srd:vitruvian-spider'), 'typed');

    // No 5xx, and no refusal of any kind on the player's cast.
    expect(intentExchanges().every((exchange) => exchange.status < 400)).toBe(true);
    // One proposal, then one commit carrying the player's own die.
    const phases = intentExchanges()
      .filter((exchange) => (exchange.body.intent as { type?: string }).type === 'spell')
      .map((exchange) => exchange.body.phase ?? 'commit');
    expect(phases).toEqual(['propose', 'commit']);
    expect(spellProposals).toHaveLength(1);
    // One prompt, asking for the spell-attack die with the engine's own numbers.
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      kind: 'spell-attack',
      weaponName: 'Chill Touch',
      attackBonus: 6,
      targetAc: 15,
      targetLabel: 'The Vitruvian Spider',
    });
    // The engine judged the player's die, not one of its own.
    expect(spellCommits).toEqual([
      expect.objectContaining({ casterId: SCHOLAR_ID, targetIds: [SPIDER_ID], d20: 14 }),
    ]);
    // One cast, one engine line — and no REFUSED line beside it.
    expect(result.text.match(/cast Chill Touch/g)).toHaveLength(1);
    expect(result.text).toContain('spell attack 14 + 6 = 20 vs AC 15');
    expect(result.text).not.toMatch(/refused/i);
    expect(repairCalls).toBe(0);
    // The commit says it came from the player's typed message.
    const commit = intentExchanges().find(
      (exchange) => exchange.body.phase === undefined && exchange.body.origin,
    );
    expect(commit?.body.origin).toBe('typed');
    expect(trackedEvents).toContainEqual(
      expect.objectContaining({ name: 'action_accepted', action: 'spell', origin: 'typed' }),
    );
  });

  it('logs a thrown gateway error beside the request id instead of a silent 500', async () => {
    proposeThrows = new TypeError('something the gateway did not expect');

    const response = await postIntent({
      intent: {
        type: 'spell',
        actorId: SCHOLAR_ID,
        targetIds: [SPIDER_ID],
        spellName: 'Chill Touch',
      },
      source: 'dm',
      phase: 'propose',
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Combat action failed' });
    expect(serverLogs).toContainEqual({
      level: 'error',
      msg: 'COMBAT_INTENT_FAILED',
      data: expect.objectContaining({
        requestId: 'req-2303',
        intentType: 'spell',
        phase: 'propose',
        errName: 'TypeError',
        errMessage: 'something the gateway did not expect',
        stack: expect.stringContaining('TypeError'),
      }),
    });
  });
});

describe('run M7 round 2: the player acts only on player input (#2305)', () => {
  it.each(['dm', 'repair'])(
    'refuses a player-actor cast whose origin is %s, and logs that origin',
    async (origin) => {
      const response = await postIntent({
        intent: {
          type: 'spell',
          actorId: SCHOLAR_ID,
          targetIds: [SPIDER_ID],
          spellId: 'chill-touch',
          spellName: 'Chill Touch',
        },
        source: 'dm',
        origin,
      });
      const body = (await response.json()) as {
        error: string;
        details?: Record<string, unknown>;
      };

      expect(response.status).toBe(422);
      expect(body.details).toMatchObject({ reason: 'player_action_without_input', origin });
      expect(spellCommits).toHaveLength(0);
      expect(serverLogs).toContainEqual({
        level: 'warn',
        msg: undefined,
        data: expect.objectContaining({ msg: 'PLAYER_ACTION_REFUSED_NO_INPUT', origin }),
      });
      expect(trackedEvents).toContainEqual(
        expect.objectContaining({ name: 'action_refused', origin }),
      );
      // Every 4xx refusal leaves one line with its reason code, for telemetry (#2374).
      expect(serverLogs).toContainEqual({
        level: 'warn',
        msg: 'COMBAT_INTENT_REFUSED',
        data: expect.objectContaining({ status: 422, reason: 'player_action_without_input' }),
      });
    },
  );

  it("accepts the player's own sheet Cast", async () => {
    const response = await postIntent({
      intent: {
        type: 'spell',
        actorId: SCHOLAR_ID,
        targetIds: [SPIDER_ID],
        spellId: 'chill-touch',
        spellName: 'Chill Touch',
      },
      source: 'dm',
      origin: 'sheet_cast',
    });

    expect(response.status).toBe(200);
    expect(spellCommits).toHaveLength(1);
  });

  it('resolves no player action on a turn the player did not start', async () => {
    setPlayerRollHost(playerRolls(19));

    // M7's round-2 line addressed both ends by participant UUID.
    const result = await resolveTurn(chillTouch(SCHOLAR_ID, SPIDER_ID), null);

    // Nothing reached the engine for the player: no proposal, no prompt, no commit.
    expect(intentExchanges()).toHaveLength(0);
    expect(prompts).toHaveLength(0);
    expect(spellCommits).toHaveLength(0);
    expect(result.text).not.toContain('cast Chill Touch');
    // Logged with its source, and the DM is told it did not happen.
    expect(clientWarnings).toContainEqual({
      msg: 'PLAYER_ACTION_REFUSED_NO_INPUT',
      data: expect.objectContaining({ source: 'dm', actionType: 'cast_spell' }),
    });
    expect(narrationCalls[0]?.withheldPlayerActions).toEqual([
      expect.objectContaining({ actor: 'The Scholar', action: 'cast_spell', source: 'dm' }),
    ]);
    expect(narrationCalls[0]?.authoritativeCombatResults).toEqual([]);
  });
});
