/* eslint-disable max-lines -- one cohesive reproduction: slug resolution at the gateway, the
   error split behind it, and the browser bridge that feeds both, sharing one mock setup. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import type { MapEntity, TacticalMap } from '../../../../tactical/types.js';
import type { AttackRollInput } from '../../../../types/combat.js';

/**
 * The case that has never once passed in production.
 *
 * `dm-attack-intent-http.test.ts` proved the DM's versionless envelope survives the route, but
 * it did so on a board whose participant ids *were* the slugs — `the-void-maw` was both the
 * entity id and the token the DM copied — so nothing in it ever exercised a translation. Real
 * encounters key participants on uuids and show the DM slugs, and every DM attack therefore
 * arrived as `actorId: "the-void-maw"` against a participant table full of uuids. The turn
 * check compared the two, found no match, and answered "Actor is not the current-turn
 * participant" — an answer about initiative order for a failure that had nothing to do with it.
 *
 * So: uuid participants, slugged board, and the tokens the DM actually emits.
 */
const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const ENCOUNTER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VOID_MAW_ID = '99999999-1111-4222-8333-444444444444';
const SEEKER_ID = '77777777-5555-4666-8777-888888888888';
const ENCOUNTER_VERSION = 12;

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
const spellInputs: Array<{ casterId: string; targetIds: string[] }> = [];
const trackedEvents: Array<Record<string, unknown>> = [];
let encounterStatus: 'active' | 'completed' = 'active';
let activeEncounter: { id: string; sessionId: string } | null = {
  id: ENCOUNTER_ID,
  sessionId: SESSION_ID,
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
    getCombatState: async () => ({
      encounter: {
        id: ENCOUNTER_ID,
        sessionId: SESSION_ID,
        status: encounterStatus,
        version: ENCOUNTER_VERSION,
      },
      participants: [
        participant(SEEKER_ID, 'The Seeker', 'player'),
        participant(VOID_MAW_ID, 'The Void-Maw', 'npc'),
      ],
      turnOrder: [],
      currentParticipant: participant(VOID_MAW_ID, 'The Void-Maw', 'npc'),
      participantSizes: {},
    }),
    getActiveEncounter: async () => activeEncounter,
    endCombat: async () => {},
  },
}));
mock.module('../../../../services/combat/combat-attack-service.js', () => ({
  CombatAttackService: class {
    async resolveAttack(_encounterId: string, input: AttackRollInput) {
      attackInputs.push(input);
      return {
        hit: true,
        finalDamage: 4,
        targetNewHp: 26,
        isCritical: false,
        damageType: 'slashing',
      };
    }
    async resolveSpellAttack(
      _encounterId: string,
      input: { casterId: string; targetIds: string[] },
    ) {
      spellInputs.push(input);
      return {
        results: input.targetIds.map(() => ({
          hit: true,
          autoHit: true,
          finalDamage: 0,
          targetNewHp: 30,
          targetIsDead: false,
          spellName: 'Thunderwave',
        })),
      };
    }
  },
}));
const CLAWS = {
  id: 'claws',
  name: 'Claws',
  damageDice: '1d6',
  damageType: 'slashing',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};
mock.module('../../../../services/combat/data-access.js', () => ({
  listEquippedWeaponProfiles: async () => [CLAWS],
  getEquippedWeaponProfile: async () => CLAWS,
  getParticipantAbilityProfile: async () => ({ scores: {}, level: 1, spellIds: [] }),
  getActiveConditionNames: async () => [],
  // Not used by this suite, but `hp-data-access.js` imports it, and the death-save
  // machinery now pulls the HP service into the intent gateway's import graph. A
  // mocked module with a missing export is a hard SyntaxError for every importer.
  verifyEncounterAccess: async () => {},
}));
mock.module('../../../../services/combat/combat-approach-service.js', () => ({
  decideAttackApproach: async () => ({ movementOnly: false, attackType: 'melee' }),
  describeResolvedAttack: () => 'The Void-Maw strikes The Seeker.',
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
// The board the DM is shown, and the only thing that knows a slug means a uuid.
mock.module('../../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => board(),
  // Facts are recorded against the latest map row rather than the active one; stubbed so
  // this suite keeps a complete module surface (a missing export is a hard failure for
  // every other file in a directory run).
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
mock.module('../../../../../../src/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({ authorization: 'Bearer valid-token' }),
  configureHeadlessSession: () => {},
  loadCachedSession: () => null,
  persistSession: () => {},
  refreshAccessTokenOnce: async () => null,
}));

const { createRequestPipelineApp } = await import('../../../../http-pipeline.js');
const { intentRoutes } = await import('../intents.js');
const { assignEntitySlugs } = await import('../../../../tactical/identity.js');
/**
 * The bridge's own action shape, restated rather than imported. A literal import — of the type
 * as much as the value — pulls the frontend module graph into `server-bun/tsconfig.json`, where
 * `@/` means the server's `src`, and its `@/services/auth/TokenService` import then resolves to
 * nothing. The runtime import below stays real; only the specifier is kept non-literal.
 */
type StructuredCombatAction = {
  actor_id: string;
  action_type: 'attack' | 'cast_spell' | 'dash' | 'disengage' | 'dodge';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
};
const bridgeModule = '../../../../../../src/services/combat/combat-action-executor';
const { executeStructuredCombatAction } = (await import(bridgeModule)) as {
  executeStructuredCombatAction(
    encounterId: string,
    action: StructuredCombatAction,
  ): Promise<unknown>;
};

function board(): TacticalMap {
  const entities = [
    entity(SEEKER_ID, 'The Seeker', 1, 'pc'),
    entity(VOID_MAW_ID, 'The Void-Maw', 2, 'monster'),
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
}

const app = createRequestPipelineApp().use(new Elysia({ prefix: '/v1/combat' }).use(intentRoutes));

const sentRequests: Array<{ url: string; body: unknown }> = [];
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

beforeEach(() => {
  encounterStatus = 'active';
  activeEncounter = { id: ENCOUNTER_ID, sessionId: SESSION_ID };
  attackInputs.length = 0;
  spellInputs.length = 0;
  trackedEvents.length = 0;
  sentRequests.length = 0;
});

describe('the active combat read', () => {
  it('returns a successful empty result when the session has no combat', async () => {
    activeEncounter = null;

    const response = await app.handle(
      new Request(`http://localhost/v1/combat/sessions/${SESSION_ID}/active`, {
        headers: { authorization: 'Bearer valid-token' },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      combat: null,
      initiativeOrder: [],
      tacticalMap: null,
    });
  });
});

describe('a DM attack addressed by slug, on the slug-holder’s own turn', () => {
  it('is accepted, and the engine is handed participant ids on both ends', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: 'the-void-maw', targetId: 'the-seeker' },
      source: 'dm',
      dmStartedAt: 1_753_500_000_000,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true });
    // The target is translated too: a slug that reaches the engine fails a uuid lookup two
    // layers down, where the error no longer mentions references at all.
    expect(attackInputs).toHaveLength(1);
    expect(attackInputs[0]).toMatchObject({
      attackerId: VOID_MAW_ID,
      targetId: SEEKER_ID,
      expectedVersion: ENCOUNTER_VERSION,
    });
    expect(trackedEvents.some((event) => event.name === 'action_refused')).toBe(false);
  });

  it('translates every target of a slug-addressed spell, not just the first', async () => {
    const response = await postIntent({
      intent: {
        type: 'spell',
        actorId: 'the-void-maw',
        targetIds: ['the-seeker', VOID_MAW_ID],
        spellName: 'Thunderwave',
      },
      source: 'dm',
    });

    expect(response.status).toBe(200);
    // Mixed dialects in one array: the DM copies slugs, the client echoes ids, both resolve.
    expect(spellInputs[0].targetIds).toEqual([SEEKER_ID, VOID_MAW_ID]);
  });

  it('accepts the uuid form unchanged, so resolution never costs the client its own ids', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: VOID_MAW_ID, targetId: SEEKER_ID },
      source: 'dm',
    });
    expect(response.status).toBe(200);
    expect(attackInputs[0]).toMatchObject({ attackerId: VOID_MAW_ID, targetId: SEEKER_ID });
  });
});

/**
 * The inverse, pinned. An actorId that resolves to nobody and an actorId that resolves to the
 * wrong participant are different bugs on the caller's side, and answering both with the
 * turn-order sentence is what sent three investigations reading initiative code.
 */
describe('an actorId matching no entity is an unknown reference, not a turn-order failure', () => {
  it('answers 404 naming the participant, never the current-turn sentence', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: 'the-marrow-king', targetId: 'the-seeker' },
      source: 'dm',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Combat participant not found');
    expect(body.error).not.toContain('current-turn');
    expect(attackInputs).toHaveLength(0);
  });

  it('still answers the turn-order sentence when the actor is real but early', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: 'the-seeker', targetId: 'the-void-maw' },
      source: 'dm',
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toBe('Actor is not the current-turn participant');
    expect(attackInputs).toHaveLength(0);
  });
});

describe('an intent that arrives after combat has concluded', () => {
  it('returns a clean no-op before resolving stale participant references', async () => {
    encounterStatus = 'completed';

    const response = await postIntent({
      intent: { type: 'end_turn', actorId: 'the-reveler-after-victory' },
      source: 'dm',
    });
    const body = (await response.json()) as {
      accepted: boolean;
      result?: { encounterAlreadyConcluded?: boolean; status?: string };
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      result: { encounterAlreadyConcluded: true, status: 'completed' },
    });
    expect(attackInputs).toHaveLength(0);
    expect(spellInputs).toHaveLength(0);
  });
});

/**
 * The 2026-08-10 production 500, at the gateway that let it through.
 *
 * The board numbers a name only when it carries duplicates, so both creatures here hold bare
 * slugs — and the DM emitted `sentient-glaze-1` for a lone `sentient-glaze` anyway. The token
 * resolved to nothing, `index.resolve` handed it back unchanged by contract, and the raw slug
 * travelled through `resolveAttack` into `inArray(combatParticipants.id, …)`, where Postgres
 * refused it as a uuid. A `DrizzleQueryError` is not an `AppError`, so the answer was a bare
 * 500 and the encounter sat active with zero actions on it.
 */
describe('the intent boundary resolves numbered slugs and refuses what it cannot resolve', () => {
  it('accepts a numbered token for a creature the board left unnumbered', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: 'the-void-maw-1', targetId: 'the-seeker-1' },
      source: 'dm',
    });

    expect(response.status).toBe(200);
    expect(attackInputs[0]).toMatchObject({ attackerId: VOID_MAW_ID, targetId: SEEKER_ID });
    expect(trackedEvents.some((event) => event.name === 'action_refused')).toBe(false);
  });

  it('answers an unresolvable target with 404 and the roster, never reaching the engine', async () => {
    const response = await postIntent({
      intent: { type: 'attack', actorId: 'the-void-maw', targetId: 'the-marrow-king' },
      source: 'dm',
    });
    const body = (await response.json()) as {
      error: string;
      details?: { role?: string; id?: string; roster?: string };
    };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Combat participant not found');
    // The roster is the half that makes the refusal actionable: it names what the DM could
    // have written instead of the token that missed.
    expect(body.details?.role).toBe('target');
    expect(body.details?.id).toBe('the-marrow-king');
    expect(body.details?.roster).toContain('the-void-maw');
    expect(body.details?.roster).toContain('the-seeker');
    // The engine is never handed a reference the board could not translate.
    expect(attackInputs).toHaveLength(0);
  });

  it('refuses an unresolvable spell target the same way, before any target resolves', async () => {
    const response = await postIntent({
      intent: {
        type: 'spell',
        actorId: 'the-void-maw',
        targetIds: ['the-seeker', 'the-marrow-king'],
        spellName: 'Thunderwave',
      },
      source: 'dm',
    });

    expect(response.status).toBe(404);
    expect(spellInputs).toHaveLength(0);
  });
});

/**
 * The browser path, end to end. `executeStructuredCombatAction` is what the React client and
 * the headless CLI both call with the DM's `combat_actions` entries verbatim — slugs included.
 */
describe('the browser bridge carries a slug actor_id all the way to the engine', () => {
  it('reaches the engine with participant ids, having sent the slug over the wire', async () => {
    await executeStructuredCombatAction(ENCOUNTER_ID, {
      actor_id: 'the-void-maw',
      action_type: 'attack',
      target_ids: ['the-seeker'],
      weapon_id: null,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    });

    // What the bridge serialized is still the DM's own token — resolution is the server's job.
    const sent = sentRequests[0].body as { intent: Record<string, unknown> };
    expect(sent.intent.actorId).toBe('the-void-maw');
    expect(sent.intent.targetId).toBe('the-seeker');
    // …and what the engine received is the encounter's own ids.
    expect(attackInputs[0]).toMatchObject({ attackerId: VOID_MAW_ID, targetId: SEEKER_ID });
  });
});
