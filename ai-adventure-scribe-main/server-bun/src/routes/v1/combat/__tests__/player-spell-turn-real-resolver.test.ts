/* eslint-disable max-lines -- two #918 replays (Hark D2-011/012) sharing one mock setup:
   the real intent route, the real intent gateway, the REAL CombatAttackService, the real
   client resolution step and handler, and the route's real pre/post-drain sequencing. The
   NPC runner itself is replaced by a canned result shaped like the real
   AdvanceNpcTurnsResult; storage leaves and the LLM are stubbed. The sibling suite
   (player-spell-turn-http.test.ts) mocks CombatAttackService itself, so the resolver's
   real output shape was never composed with the route and the client formatter before
   this file. */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type { MapEntity, TacticalMap } from '../../../../tactical/types.js';

const SESSION_ID = '235c24e4-f776-43fa-8f70-4b8478317953';
const ENCOUNTER_ID = 'e570e444-197c-43c9-a43b-edbd61e11792';
const MERLIN_ID = '465816e1-0000-4000-8000-000000000001';
const BALTHAZAR_ID = '779792b2-0000-4000-8000-000000000002';
const ENCOUNTER_VERSION = 3;

const hp = new Map<string, number>([
  [MERLIN_ID, 20],
  [BALTHAZAR_ID, 34],
]);
const damageCalls: Array<{ participantId: string; amount: number }> = [];

const participantRow = (
  id: string,
  name: string,
  participantType: 'player' | 'npc',
  armorClass: number,
  maxHp: number,
) => ({
  id,
  name,
  participantType,
  isActive: true,
  characterId: participantType === 'player' ? 'char-merlin' : null,
  armorClass,
  maxHp,
  damageImmunities: [] as string[],
  damageResistances: [] as string[],
  damageVulnerabilities: [] as string[],
  encounterId: ENCOUNTER_ID,
  encounter: { sessionId: SESSION_ID, currentRound: 1 },
  status: {
    currentHp: hp.get(id) ?? maxHp,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  },
});
const merlinRow = () => participantRow(MERLIN_ID, 'Merlin Swift', 'player', 12, 20);
const balthazarRow = () => participantRow(BALTHAZAR_ID, 'Head Chef Balthazar', 'npc', 15, 34);

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

function board(): TacticalMap {
  const entities = [
    entity(MERLIN_ID, 'Merlin Swift', 1, 'pc'),
    entity(BALTHAZAR_ID, 'Head Chef Balthazar', 4, 'monster'),
  ];
  return {
    id: 'map',
    sessionId: SESSION_ID,
    width: 10,
    height: 10,
    round: 1,
    sceneDescription: 'the feast hall',
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

const trackedEvents: Array<Record<string, unknown>> = [];
const serverLogs: Array<{ level: string; data: unknown; msg?: unknown }> = [];
const clientWarnings: Array<{ msg: unknown; data: unknown }> = [];
const narrationCalls: Array<Record<string, unknown>> = [];

const serverLog = (level: string) => (data: unknown, msg?: unknown) => {
  serverLogs.push({ level, data, msg });
};
mock.module('../../../../../../db/client', () => ({
  withNpcActionTransaction: async (_id: string, work: () => Promise<unknown>) => work(),
  db: {},
}));
mock.module('../../../../services/combat/npc-engine-row.js', () => ({
  writeNpcEngineRow: async () => [],
  writeNpcCapRow: async () => [],
  readNpcEngineResult: async () => undefined,
}));
const order: string[] = [];
let drainDropsMerlin = false;
mock.module('../../../../services/combat/npc-turn-runner.js', () => ({
  isProvoked: () => false,
  nonHostileDisposition: () => false,
  advanceNpcTurns: async () => {
    order.push('drain');
    if (drainDropsMerlin) hp.set(MERLIN_ID, 0);
    holderId = MERLIN_ID;
    return {
      results: [
        {
          action: {
            actor_id: BALTHAZAR_ID,
            action_type: 'attack',
            target_ids: [MERLIN_ID],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
          round: 2,
          outcomes: [{ participantId: MERLIN_ID, hit: true, finalDamage: 20 }],
          engineResult: { actorName: 'Head Chef Balthazar', targetName: 'Merlin Swift', hit: true, d20: 18 },
          actorIsPlayer: false,
          transcriptLines: [],
        },
      ],
      currentParticipant: merlinRow(),
      round: 2,
      combatEnded: false,
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: ['Balthazar strikes Merlin down.'],
      engineRows: [],
    };
  },
}));
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
    request.headers.get('authorization') === 'Bearer <redacted>'
      ? { user: { userId: 'user_owner', email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));
mock.module(import.meta.resolve('../helpers.js'), () => ({
  verifySessionOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
  verifyEncounterOwnership: async () => ({ success: true, session: { id: SESSION_ID } }),
}));
let holderId = MERLIN_ID;
mock.module('../../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getCombatState: async () => ({
      encounter: {
        id: ENCOUNTER_ID,
        sessionId: SESSION_ID,
        status: 'active',
        version: ENCOUNTER_VERSION,
      },
      participants: [merlinRow(), balthazarRow()],
      turnOrder: [],
      currentParticipant: holderId === MERLIN_ID ? merlinRow() : balthazarRow(),
      participantSizes: {},
    }),
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    getLatestConcludedEncounter: async () => null,
    endCombat: async () => {},
  },
}));
mock.module('../../../../services/combat-initiative-service.js', () => ({
  CombatInitiativeService: class {
    static async advanceTurn() {
      holderId = BALTHAZAR_ID;
      return { currentParticipant: balthazarRow(), round: 2 };
    }
    static async getCurrentTurn() {
      return { id: MERLIN_ID };
    }
  },
}));
// The union data-access mock: the intent gateway's leaves plus the real attack service's.
mock.module('../../../../services/combat/data-access.js', () => ({
  listEquippedWeaponProfiles: async () => [],
  listCarriedWeaponProfiles: async () => [],
  getEquippedWeaponProfile: async () => null,
  getParticipantWithStats: async (id: string) => {
    const participant = id === MERLIN_ID ? merlinRow() : balthazarRow();
    return { participant, stats: null };
  },
  getParticipantsWithStatsBatch: async (ids: string[]) =>
    new Map(
      ids.map((id) => {
        const participant = id === MERLIN_ID ? merlinRow() : balthazarRow();
        return [id, { participant, stats: null }] as const;
      }),
    ),
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  createWeaponAttack: async () => null,
  getParticipantAbilityProfile: async (participant: { id: string }) =>
    participant.id === MERLIN_ID
      ? {
          level: 3,
          className: 'Wizard',
          savingThrowProficiencies: [],
          scores: { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 10 },
          saveBonuses: {},
          spellIds: ['fire-bolt', 'burning-hands', 'magic-missile'],
        }
      : {
          level: 1,
          className: null,
          savingThrowProficiencies: [],
          scores: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 12 },
          saveBonuses: {},
          spellIds: [],
        },
  getActiveConditionNames: async () => [],
  monsterAttackSource: () => 'generic',
  countStandingMooks: async () => 0,
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
// Leaves under the REAL CombatAttackService.
mock.module('../../../../services/combat-hp-service.js', () => ({
  CombatHPService: {
    applyDamage: async (
      participantId: string,
      _encounterId: string,
      options: { damageAmount: number },
    ) => {
      const amount = Number(options.damageAmount);
      damageCalls.push({ participantId, amount });
      const next = Math.max(0, (hp.get(participantId) ?? 0) - amount);
      hp.set(participantId, next);
      return {
        damageDealt: amount,
        newCurrentHp: next,
        isConscious: next > 0,
        isDead: next <= 0,
      };
    },
    healDamage: async () => ({}),
  },
}));
mock.module('../../../../services/spell-slots-service.js', () => ({
  SpellSlotsService: { useSpellSlot: async () => ({ used: true }) },
}));
mock.module('../../../../services/combat/combat-turn-resources.js', () => ({
  consumeAction: async () => {},
  claimTurnAction: async () => {},
  claimTurnVersion: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  claimTurnBonusAction: async () => {},
  releaseTurnAction: async () => {},
  releaseTurnBonusAction: async () => {},
  resetTurnResources: async () => {},
  setDefensiveAction: async () => {},
  claimTurnActionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  claimTurnBonusActionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  claimTurnReactionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    version: number,
    resolve: (version: number) => Promise<unknown>,
  ) => resolve(version),
  // #975: session-service imports withPreservedActionSurgeMark and the
  // fighter-features resolver imports readActionSurgeMark / armActionSurge
  // from this module. No case in this suite arms a surge, so the incoming
  // blob passes through unchanged and the mark reads as absent, exactly as
  // the real helpers behave with no mark.
  withPreservedActionSurgeMark: (_session: unknown, nextState: unknown) => nextState,
  readActionSurgeMark: () => null,
  armActionSurge: async () => {},
  // Round 4: session-service folds the surge-mark preservation into its
  // UPDATE through this name. No mark can be stored in this suite's world
  // (armActionSurge above is a no-op), so the merge reduces to stripping the
  // key from the incoming blob, which is what the real expression computes
  // when no valid mark is stored.
  actionSurgePreservingState: (incoming: unknown) => {
    const next =
      incoming && typeof incoming === 'object' ? { ...(incoming as Record<string, unknown>) } : {};
    delete next.actionSurgeArmed;
    return next;
  },
}));
mock.module('../../../../services/combat/concentration-service.js', () => ({
  getConcentration: async () => null,
  getConcentrationTargetingParticipant: async () => null,
  startConcentration: async () => {},
}));
mock.module('../../../../services/combat/npc-provocation.js', () => ({
  markPlayerDamageProvocation: async () => [],
}));

// ---- The client side: real resolution step and spell popup; only its edges are stubbed. ----
const CLIENT = '../../../../../../src';
mock.module(`${CLIENT}/services/auth/TokenService`, () => ({
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {},
  getAuthHeaders: () => ({ authorization: 'Bearer <redacted>' }),
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
      return { text: 'The mote of fire streaks across the hall.', narrationSegments: [] };
    },
  },
  formatConversationHistoryMessage: (message: unknown) => message,
}));
mock.module(`${CLIENT}/services/combat/combat-repair`, () => ({
  repairRefusedCombatAction: async () => null,
}));
const ENTER_PAYLOAD = {
  encounter: { id: ENCOUNTER_ID },
  first_action: {
    type: 'spell',
    actor: MERLIN_ID,
    actorLabel: 'Merlin Swift',
    target: BALTHAZAR_ID,
    targetLabel: 'Head Chef Balthazar',
    source: 'spell',
    attackSource: 'spell',
    weaponId: null,
    weaponName: null,
    spellId: 'fire-bolt',
    slotLevel: null,
    combat_action: {
      actor_id: MERLIN_ID,
      action_type: 'cast_spell',
      target_ids: [BALTHAZAR_ID],
      weapon_id: null,
      spell_id: 'fire-bolt',
      slot_level: null,
      movement_feet: 0,
    },
  },
};
mock.module(`${CLIENT}/services/user-data-api`, () => ({
  userDataApi: {
    enterCombat: async () => ({
      ok: true,
      status: 200,
      json: async () => ENTER_PAYLOAD,
    }),
    endTacticalMap: async () => ({ ok: true }),
    applyDmTacticalActions: async () => ({ ok: true, json: async () => ({}) }),
    applyDmHandoutActions: async () => ({ ok: true, json: async () => ({}) }),
    resolveAoECast: async () => ({ ok: true, json: async () => ({}) }),
    setPendingCombatIntent: async () => ({ ok: true, json: async () => ({}) }),
    clearPendingCombatIntent: async () => ({ ok: true, json: async () => ({}) }),
    promotePendingCombatIntent: async () => ({ ok: true, json: async () => ({}) }),
  },
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');

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
const handlerModule = `${CLIENT}/hooks/ai/dm-actions-handler`;
const { handleDmActionsAndTransitions } = (await import(handlerModule)) as {
  handleDmActionsAndTransitions(params: Record<string, unknown>): Promise<Record<string, unknown>>;
};
const rollBridgeModule = `${CLIENT}/services/combat/player-roll-bridge`;
const { setPlayerRollHost } = (await import(rollBridgeModule)) as {
  setPlayerRollHost(host: RollHost | null): void;
};

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

const prompts: Array<Record<string, unknown>> = [];
const playerRolls = (d20: number): RollHost => ({
  present: (spec, settle) => {
    prompts.push(spec);
    settle({ d20 });
    return { rollId: `roll-${prompts.length}`, dismiss: () => {} };
  },
});

const PARTICIPANTS = [
  { id: MERLIN_ID, name: 'Merlin Swift', participantType: 'player', turnOrder: 1 },
  { id: BALTHAZAR_ID, name: 'Head Chef Balthazar', participantType: 'npc', turnOrder: 0 },
];

const fireBolt = (): ClientAction => ({
  actor_id: MERLIN_ID,
  action_type: 'cast_spell',
  target_ids: [BALTHAZAR_ID],
  weapon_id: null,
  spell_id: 'fire-bolt',
  slot_level: null,
  movement_feet: 0,
});

const resolveTurn = () =>
  resolveDeclaredCombatActions({
    encounterId: ENCOUNTER_ID,
    sessionId: SESSION_ID,
    combatActions: [fireBolt()],
    declarationText: 'I cast Fire Bolt at Balthazar.',
    participants: PARTICIPANTS,
    aiContext: { sessionId: SESSION_ID, gameState: { isInCombat: true } },
    conversationHistory: [],
    combatRound: 1,
    playerInputOrigin: 'typed',
  });

const intentExchanges = () => exchanges.filter((exchange) => exchange.url.endsWith('/intent'));

const postIntent = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer <redacted>',
        'x-request-id': 'req-918',
      },
      body: JSON.stringify(body),
    }),
  );

const spellIntent = () => ({
  intent: {
    type: 'spell',
    actorId: MERLIN_ID,
    targetIds: [BALTHAZAR_ID],
    spellId: 'fire-bolt',
    spellName: 'Fire Bolt',
    d20: 14,
  },
  source: 'dm',
  origin: 'typed',
});

beforeEach(() => {
  holderId = MERLIN_ID;
  drainDropsMerlin = false;
  order.length = 0;
  hp.set(MERLIN_ID, 20);
  hp.set(BALTHAZAR_ID, 34);
  damageCalls.length = 0;
  trackedEvents.length = 0;
  serverLogs.length = 0;
  clientWarnings.length = 0;
  narrationCalls.length = 0;
  exchanges.length = 0;
  prompts.length = 0;
  setPlayerRollHost(null);
});

// Warm-up: the first resolution pays the one-time lazy module-graph cost of the client
// resolution step, the DM-actions handler, and the executor chain. Under load that cost
// once pushed this file's first test past the default timeout; paying it here, outside
// any test, keeps each test's budget for its own assertions. beforeEach resets all state
// the warm-up touches before the first test runs.
beforeAll(async () => {
  setPlayerRollHost(playerRolls(10));
  await resolveTurn();
});

describe('#918 D2-012: a tray-rolled Fire Bolt through the real resolver', () => {
  it('prints the hit line with the player d20 for a tray-rolled Fire Bolt (hit)', async () => {
    setPlayerRollHost(playerRolls(14));

    const result = await resolveTurn();

    expect(intentExchanges().every((exchange) => exchange.status < 400)).toBe(true);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ kind: 'spell-attack', weaponName: 'Fire Bolt' });
    expect(result.text).toMatch(
      /Merlin Swift cast Fire Bolt at Head Chef Balthazar — spell attack 14 \+ 5 = 19 vs AC 15 — HIT\. \d+ fire damage\./,
    );
    expect(damageCalls).toHaveLength(1);
  }, 30_000);

  it('prints the miss line with the player d20 for a tray-rolled Fire Bolt (miss)', async () => {
    setPlayerRollHost(playerRolls(4));

    const result = await resolveTurn();

    expect(intentExchanges().every((exchange) => exchange.status < 400)).toBe(true);
    expect(result.text).toContain(
      'Merlin Swift cast Fire Bolt at Head Chef Balthazar — spell attack 4 + 5 = 9 vs AC 15 — MISS.',
    );
    expect(damageCalls).toHaveLength(0);
  }, 30_000);

  it('still prints the line when the tray never answers and the engine rolls the die', async () => {
    // The popup's 45 s timer (or a missing dice host) settles { d20: null }: the cast commits
    // with no player die and the engine rolls — the line must print with the engine's die.
    setPlayerRollHost({
      present: (_spec, settle) => {
        settle({ d20: null });
        return { rollId: 'roll-timeout', dismiss: () => {} };
      },
    });

    const result = await resolveTurn();

    expect(intentExchanges().every((exchange) => exchange.status < 400)).toBe(true);
    expect(result.text).toMatch(
      /Merlin Swift cast Fire Bolt at Head Chef Balthazar — spell attack \d+ \+ 5 = \d+ vs AC 15 — (HIT|MISS)\./,
    );
  }, 30_000);
});


describe('#918 D2-011: the drain, the gate, and the cast on the real route', () => {
  it('a caster dropped to 0 HP by the pre-drain has the queued cast refused, not resolved', async () => {
    holderId = BALTHAZAR_ID; // Balthazar holds the turn; Merlin's cast was declared ahead.
    drainDropsMerlin = true; // His drained attack drops Merlin to 0 HP.

    const response = await postIntent(spellIntent());
    const body = (await response.json()) as {
      error?: string;
      details?: { reason?: string };
      result?: unknown;
    };

    expect(order).toEqual(['drain']); // the creatures ran first, as the route is built to do
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(body.result).toBeUndefined();
    expect(JSON.stringify(body)).toMatch(/downed|actor_unconscious/);
    expect(hp.get(BALTHAZAR_ID)).toBe(34); // the cast never resolved: no damage
    expect(damageCalls).toHaveLength(0);
  }, 30_000);

  it('on the caster turn the cast resolves first; the drain runs only at the boundary', async () => {
    holderId = MERLIN_ID;

    const castResponse = await postIntent(spellIntent());
    const castBody = (await castResponse.json()) as {
      result?: { results?: Array<{ hit?: boolean }> };
    };
    expect(castResponse.status).toBe(200);
    expect(castBody.result?.results?.[0]?.hit).toBe(true);
    expect(order).toEqual([]); // no creature ran before the player's own action

    const endResponse = await postIntent({
      intent: { type: 'end_turn', actorId: MERLIN_ID, actionId: '918-end-turn-1' },
      source: 'dm',
      origin: 'typed',
    });
    expect(endResponse.status).toBe(200);
    expect(order).toEqual(['drain']); // Balthazar's turn is drained after the boundary
  }, 30_000);
});

const entryRolls: RollHost = {
  present: (spec, settle) => {
    prompts.push(spec);
    settle({ d20: 'initiativeModifier' in spec ? 16 : 14 });
    return { rollId: `roll-${prompts.length}`, dismiss: () => {} };
  },
};

describe('#918 D2-012: Fire Bolt as the combat-entry first action (full handler)', () => {
  it('prints the hit line after entry seating, the tray roll, and the real route', async () => {
    setPlayerRollHost(entryRolls);
    const refreshedEncounter = {
      id: ENCOUNTER_ID,
      phase: 'active',
      currentTurnParticipantId: MERLIN_ID,
      currentRound: 1,
      participants: [
        { id: MERLIN_ID, characterId: 'char-merlin', name: 'Merlin Swift', participantType: 'player', isActive: true },
        { id: BALTHAZAR_ID, name: 'Head Chef Balthazar', participantType: 'npc', isActive: true },
      ],
    };
    const returned = await handleDmActionsAndTransitions({
      sessionId: SESSION_ID,
      result: {
        text: 'The chef whirls around, cleaver raised!',
        combat_transition: 'none',
        combat_entry_pending: {
          trigger: 'tactical_action',
          detail: 'combat_action cast_spell',
          combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
          sceneSpec: { environment: 'dungeon_room' },
          sceneSpecSynthesized: true,
        },
        combat_actions: [
          {
            actor_id: BALTHAZAR_ID,
            action_type: 'attack',
            target_ids: [MERLIN_ID],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ],
      },
      characterRecord: {
        id: 'char-merlin',
        name: 'Merlin Swift',
        dexterity: 14,
        currentHitPoints: 20,
        maxHitPoints: 20,
      },
      activeEncounter: null,
      isInCombat: false,
      refreshCombatState: async () => refreshedEncounter,
      aiContext: { sessionId: SESSION_ID, gameState: {} },
      conversationHistory: [],
      playerMessage: 'I cast Fire Bolt at Balthazar!',
      playerInputOrigin: 'typed',
      entryConfirmed: true,
    });

    const allText = JSON.stringify(returned);
    expect(intentExchanges().every((exchange) => exchange.status < 400)).toBe(true);
    expect(allText).toMatch(/cast Fire Bolt at Head Chef Balthazar/);
    expect(allText).toMatch(/spell attack 14 \+ 5 = 19 vs AC 15 — HIT/);
  }, 30_000);
});
