/* eslint-disable max-lines -- one cohesive reproduction: the run-10 dispatch failure plus the
   honest-rejection contract, sharing a single module-mock setup. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type {
  DMResponse,
  DMTargetedCombatAction,
} from '../../../../services/dm/dm-response-schema.js';
import type { MapEntity, TacticalMap } from '../../../../tactical/types.js';
import type { AttackRollInput } from '../../../../types/combat.js';

/**
 * The missing link.
 *
 * 5bfa69df proved that all three attack dialects produce `combat_actions`. Nothing proved
 * that the intent call built from one of those actions satisfies the route that receives it.
 * It did not: the DM-side constructor omitted `expectedVersion`, the whole `t.Union` failed,
 * and the pipeline answered `Internal Server Error`. Run 10 died at turn 1, three times, on
 * this body:
 *
 *   {"intent":{"type":"attack","actorId":"the-void-maw","targetId":"the-seeker"},
 *    "source":"dm","dmStartedAt":...}
 *
 * So this drives the whole chain — DM envelope, acceptance ladder, the real browser/CLI
 * bridge, the real route, the real dispatch — with only the database-bound leaves faked. The
 * seam that lied is the one under test: nothing here hand-writes an intent body.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/** Whatever the encounter's version happens to be, the DM never had to know it. */
const ENCOUNTER_VERSION = 7;

const entity = (id: string, name: string, x: number, y: number, type: 'pc' | 'monster') =>
  ({
    id,
    name,
    x,
    y,
    size: 'medium',
    type,
    speedFeet: 30,
    movementRemaining: 30,
  }) satisfies MapEntity;

const participant = (id: string, name: string, participantType: 'player' | 'npc') => ({
  id,
  name,
  participantType,
  isActive: true,
  maxHp: 30,
  armorClass: 14,
  encounterId: ENCOUNTER_ID,
  status: { currentHp: 30 },
});

const attackInputs: AttackRollInput[] = [];
const dmFacts: string[] = [];
const trackedEvents: Array<Record<string, unknown>> = [];

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
    getCombatState: async () => ({
      encounter: {
        id: ENCOUNTER_ID,
        sessionId: SESSION_ID,
        status: 'active',
        version: ENCOUNTER_VERSION,
      },
      participants: [
        participant('the-seeker', 'The Seeker', 'player'),
        participant('the-void-maw', 'The Void-Maw', 'npc'),
      ],
      turnOrder: [],
      currentParticipant: participant('the-void-maw', 'The Void-Maw', 'npc'),
      participantSizes: {},
    }),
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    endCombat: async () => {},
  },
}));
// The database-bound leaf. Everything above it — route schema, dispatch, version ownership —
// is the real thing, and what it was handed is what these tests assert on.
mock.module('../../../../services/combat/combat-attack-service.js', () => ({
  CombatAttackService: class {
    async resolveAttack(_encounterId: string, input: AttackRollInput) {
      attackInputs.push(input);
      return {
        hit: true,
        finalDamage: 0,
        targetNewHp: 24,
        isCritical: false,
        damageType: 'slashing',
      };
    }
    async resolveSpellAttack() {
      return { results: [] };
    }
  },
}));
mock.module('../../../../services/combat/data-access.js', () => ({
  getEquippedWeaponProfile: async () => ({
    id: 'claws',
    name: 'Claws',
    ranged: false,
    normalRange: 5,
  }),
  getParticipantAbilityProfile: async () => ({ scores: {}, level: 1, spellIds: [] }),
  getActiveConditionNames: async () => [],
}));
mock.module('../../../../services/combat/combat-approach-service.js', () => ({
  decideAttackApproach: async () => ({ movementOnly: false, attackType: 'melee' }),
  describeResolvedAttack: () => 'The Void-Maw strikes The Seeker.',
}));
mock.module('../../../../services/combat/tactical-action-service.js', () => ({
  recordDmTacticalFact: async (_sessionId: string, fact: string) => {
    dmFacts.push(fact);
  },
  applyTacticalMapAction: async () => ({ applied: true }),
}));
mock.module('../../../../services/combat/tactical-combat-lifecycle.js', () => ({
  destroyTacticalCombatMap: async () => {},
  grantTacticalDash: async () => ({ applied: true }),
  resetTacticalMovementForTurn: async () => {},
}));
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => null,
  saveTacticalMap: async () => {},
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
mock.module('../../../../../../src/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({ authorization: 'Bearer valid-token' }),
  configureHeadlessSession: () => {},
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');
const { acceptWhateverWasEmitted } = await import('../../../../tactical/accept-attack-dialects.js');
const { assignEntitySlugs } = await import('../../../../tactical/identity.js');
const { buildTacticalPrompt } = await import('../../../../tactical/prompt.js');
/**
 * The real browser/CLI bridge, loaded through a non-literal specifier on purpose: the frontend
 * tree resolves `@/` against its own `src`, and pulling its module graph into
 * `server-bun/tsconfig.json` — where `@/` means the server's `src` — makes those imports
 * resolve to the wrong files or to nothing. This keeps the runtime import real and the
 * typecheck honest; `DMTargetedCombatAction` is structurally the bridge's own action type.
 */
const bridgeModule = '../../../../../../src/services/combat/combat-action-executor';
const { executeStructuredCombatAction } = (await import(bridgeModule)) as {
  executeStructuredCombatAction(
    encounterId: string,
    action: DMTargetedCombatAction,
  ): Promise<unknown>;
};

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

/** Every request the bridge made, in order, with the body it actually serialized. */
const sentRequests: Array<{ url: string; body: unknown }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  sentRequests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  return app.handle(new Request(url, init));
}) as typeof globalThis.fetch;

const board = (): TacticalMap => {
  const entities = [
    entity('the-seeker', 'The Seeker', 1, 1, 'pc'),
    entity('the-void-maw', 'The Void-Maw', 2, 1, 'monster'),
  ];
  assignEntitySlugs(entities);
  return {
    id: 'map',
    sessionId: SESSION_ID,
    width: 10,
    height: 10,
    round: 1,
    sceneDescription: 'the drowned hall',
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
};

const promptFor = (activeId: string): string =>
  `<tactical_context>\n${buildTacticalPrompt(board(), activeId)}\n</tactical_context>\n` +
  `<immutable_game_state>{"isInCombat":true,"encounterId":"${ENCOUNTER_ID}"}</immutable_game_state>`;

const dmResponse = (overrides: Partial<DMResponse> = {}): DMResponse =>
  ({
    text: '',
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'none',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  }) as DMResponse;

/** Runs an envelope through the acceptance ladder and returns the actions it produced. */
const actionsFrom = (response: DMResponse) => {
  const accepted = acceptWhateverWasEmitted(response, promptFor('the-void-maw'), true);
  const actions = (accepted.response.combat_actions ?? []).filter(
    (action): action is DMTargetedCombatAction => 'target_ids' in action,
  );
  return { accepted, actions };
};

const postIntent = (body: unknown) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer valid-token' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  attackInputs.length = 0;
  dmFacts.length = 0;
  trackedEvents.length = 0;
  sentRequests.length = 0;
});

describe('a translated legacy attack reaches the engine through the real intent route', () => {
  it('resolves without the DM ever supplying a version', async () => {
    const { accepted, actions } = actionsFrom(
      dmResponse({
        text: 'The Void-Maw surges up out of the flooded stone.',
        roll_requests: [
          {
            type: 'attack',
            formula: '1d20+5',
            purpose: 'Attack roll with claws against The Seeker',
            dc: null,
            ac: 14,
            advantage: false,
            disadvantage: false,
          },
        ],
      } as Partial<DMResponse>),
    );

    // Layer 2 claimed it: this is the legacy roll_request dialect, not a hand-written action.
    expect(accepted.translation).not.toBeNull();
    expect(accepted.inference).toBeNull();
    expect(actions).toHaveLength(1);

    await executeStructuredCombatAction(ENCOUNTER_ID, actions[0]);

    // The bridge went straight to the intent route — no version read, because it does not own one.
    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0].url).toBe(`http://localhost:8888/v1/combat/${ENCOUNTER_ID}/intent`);
    const sent = sentRequests[0].body as { intent: Record<string, unknown>; source: string };
    expect(sent.source).toBe('dm');
    expect(sent.intent.type).toBe('attack');
    expect(sent.intent).not.toHaveProperty('expectedVersion');

    // …and the engine was handed the encounter's real version, resolved server-side.
    expect(attackInputs).toHaveLength(1);
    expect(attackInputs[0]).toMatchObject({
      attackerId: 'the-void-maw',
      targetId: 'the-seeker',
      expectedVersion: ENCOUNTER_VERSION,
    });
    expect(trackedEvents.some((event) => event.name === 'action_accepted')).toBe(true);
    expect(trackedEvents.some((event) => event.name === 'action_refused')).toBe(false);
  });
});

describe('a prose-inferred attack reaches the engine through the real intent route', () => {
  it('resolves without the DM ever supplying a version', async () => {
    const { accepted, actions } = actionsFrom(
      dmResponse({
        text: 'The Void-Maw lunges at The Seeker, jaws yawning wide across the black water.',
      }),
    );

    // Layer 3 claimed it: narration alone, no structured channel populated.
    expect(accepted.translation).toBeNull();
    expect(accepted.inference).not.toBeNull();
    expect(actions).toHaveLength(1);

    await executeStructuredCombatAction(ENCOUNTER_ID, actions[0]);

    const sent = sentRequests[0].body as { intent: Record<string, unknown>; source: string };
    expect(sent.source).toBe('dm');
    expect(sent.intent).not.toHaveProperty('expectedVersion');
    expect(attackInputs[0]).toMatchObject({
      attackerId: 'the-void-maw',
      targetId: 'the-seeker',
      expectedVersion: ENCOUNTER_VERSION,
    });
  });
});

describe('the run-10 body, verbatim', () => {
  const RUN_10_BODY = {
    intent: { type: 'attack', actorId: 'the-void-maw', targetId: 'the-seeker' },
    source: 'dm',
    dmStartedAt: 1_753_500_000_000,
  };

  it('is accepted and resolved, where it used to be a 500', async () => {
    const response = await postIntent(RUN_10_BODY);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(attackInputs[0]).toMatchObject({ expectedVersion: ENCOUNTER_VERSION });
  });

  it('is still rejected — honestly — when a player sends it', async () => {
    const response = await postIntent({ ...RUN_10_BODY, source: 'player' });
    const body = (await response.json()) as {
      error: string;
      stage: string;
      dialect: string;
      variant: string;
      missing: string[];
      detail: string;
    };

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      error: 'Invalid combat intent',
      stage: 'intent_schema',
      dialect: 'player',
      variant: 'attack',
      missing: ['expectedVersion'],
    });
    expect(body.detail).toContain('expectedVersion');
    // The lie that hid this for a whole run.
    expect(JSON.stringify(body)).not.toContain('Internal Server Error');
    expect(attackInputs).toHaveLength(0);
  });
});

describe('honest rejection of anything the intent union refuses', () => {
  it('names the missing field of the variant that did not match', async () => {
    const response = await postIntent({
      intent: { type: 'spell', actorId: 'the-seeker', targetIds: ['the-void-maw'] },
      source: 'dm',
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      dialect: 'dm',
      variant: 'spell',
      // `expectedVersion` is optional for the DM; `spellName` is not optional for anyone.
      missing: ['spellName'],
    });
  });

  it('names the known variants when the intent type matches none of them', async () => {
    const response = await postIntent({
      intent: { type: 'parry', actorId: 'the-seeker' },
      source: 'dm',
    });
    const body = (await response.json()) as { variant: string | null; detail: string };
    expect(response.status).toBe(422);
    expect(body.variant).toBeNull();
    expect(body.detail).toContain('"parry"');
    expect(body.detail).toContain('attack');
  });

  it('never answers a bad body with a 5xx', async () => {
    for (const body of [
      { intent: { type: 'attack' }, source: 'dm' },
      { intent: { type: 'move', actorId: 'the-seeker', x: 'over there' }, source: 'dm' },
      { intent: 'attack the seeker', source: 'dm' },
    ]) {
      const response = await postIntent(body);
      expect(response.status).toBeLessThan(500);
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});
