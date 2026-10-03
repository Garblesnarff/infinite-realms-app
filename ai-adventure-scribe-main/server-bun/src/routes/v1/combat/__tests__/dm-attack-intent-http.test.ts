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
/** Every weapon the approach decision was asked to reach-check with, in order. */
const approachWeapons: Array<{ name: string; ranged: boolean; normalRange: number }> = [];
/** Everything the real logger was told to warn about; `DM_WEAPON_UNGROUNDED` lands here. */
const warnings: Array<Record<string, unknown>> = [];

/** Whose turn it is. The seeker's own turn is needed to drive a player-character attack. */
let activeParticipantId = 'the-void-maw';

/**
 * The Seeker's actual sheet: a longbow and a shortsword, bow first — the order the old
 * `candidates[0]` default would have picked out.
 */
const SEEKER_WEAPONS = [
  {
    id: 'inv-longbow',
    name: 'Longbow',
    damageDice: '1d8',
    damageType: 'piercing',
    normalRange: 150,
    longRange: 600,
    magicBonus: 0,
    finesse: false,
    ranged: true,
    proficient: true,
  },
  {
    id: 'inv-shortsword',
    name: 'Shortsword',
    damageDice: '1d6',
    damageType: 'piercing',
    normalRange: 5,
    magicBonus: 0,
    finesse: true,
    ranged: false,
    proficient: true,
  },
];

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

/** Keyed by participant id, so each actor's sheet is its own. */
const equippedByActor: Record<string, typeof SEEKER_WEAPONS> = {
  'the-seeker': SEEKER_WEAPONS,
  'the-void-maw': [CLAWS],
};

mock.module('../../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../../lib/logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: (payload: Record<string, unknown>) => {
      warnings.push(payload);
    },
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
      currentParticipant:
        activeParticipantId === 'the-seeker'
          ? participant('the-seeker', 'The Seeker', 'player')
          : participant('the-void-maw', 'The Void-Maw', 'npc'),
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
        d20: 12,
        attackBonus: 4,
        targetAC: 14,
        totalAttackRoll: 16,
        finalDamage: 0,
        targetNewHp: 24,
        targetCondition: 'wounded',
        isCritical: false,
        damageType: 'slashing',
        autoRolled: true,
      };
    }
    async resolveSpellAttack() {
      return { results: [] };
    }
  },
}));
// The sheet-reading leaf. `weapon-grounding` on top of it is the real thing, so what these
// tests exercise is the grounding rule, not a stub of it.
mock.module('../../../../services/combat/data-access.js', () => ({
  listEquippedWeaponProfiles: async (participant: { id: string }) =>
    equippedByActor[participant.id] ?? [],
  getEquippedWeaponProfile: async (participant: { id: string }) =>
    equippedByActor[participant.id]?.[0] ?? CLAWS,
  getParticipantAbilityProfile: async () => ({ scores: {}, level: 1, spellIds: [] }),
  getActiveConditionNames: async () => [],
  // Not used by this suite, but `hp-data-access.js` imports it, and the death-save
  // machinery now pulls the HP service into the intent gateway's import graph. A
  // mocked module with a missing export is a hard SyntaxError for every importer.
  verifyEncounterAccess: async () => {},
}));
mock.module('../../../../services/combat/combat-approach-service.js', () => ({
  decideAttackApproach: async ({
    weapon,
  }: {
    weapon: { name: string; ranged: boolean; normalRange: number };
  }) => {
    approachWeapons.push(weapon);
    // The one rule `decideAttackApproach` applies before it reach-checks: `weapon.normalRange`
    // is the reach it hands to `approachForAttack`, and `ranged` picks the attack type.
    return { movementOnly: false, attackType: weapon.ranged ? 'ranged' : 'melee' };
  },
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
  // No board in this suite, so no latest row either. Stubbed rather than omitted: an absent
  // export is a hard "not found" for every importer in a directory run.
  loadLatestTacticalMapRow: async () => null,
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

const postIntent = (body: unknown, requestId?: string) =>
  app.handle(
    new Request(`http://localhost/v1/combat/${ENCOUNTER_ID}/intent`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  attackInputs.length = 0;
  dmFacts.length = 0;
  trackedEvents.length = 0;
  sentRequests.length = 0;
  approachWeapons.length = 0;
  warnings.length = 0;
  activeParticipantId = 'the-void-maw';
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
    const response = await postIntent({ ...RUN_10_BODY, source: 'player' }, 'req-schema-2094');
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
    expect(warnings).toContainEqual(
      expect.objectContaining({
        requestId: 'req-schema-2094',
        field: 'expectedVersion',
        reason: expect.stringContaining('expectedVersion'),
      }),
    );
  });
});

describe('typed dialog roll wire body (#2547)', () => {
  it('accepts the real client commit and forwards the kept d20', async () => {
    activeParticipantId = 'the-seeker';
    const { executeStructuredCombatActionWithBoundary } = await import(bridgeModule);
    await executeStructuredCombatActionWithBoundary(
      ENCOUNTER_ID,
      {
        actor_id: 'the-seeker',
        action_type: 'attack',
        target_ids: ['the-void-maw'],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      8,
      'typed',
    );
    expect(sentRequests).toHaveLength(1);
    expect(sentRequests[0].body).toEqual({
      intent: { type: 'attack', actorId: 'the-seeker', targetId: 'the-void-maw', d20: 8 },
      source: 'dm',
      origin: 'typed',
      dmStartedAt: expect.any(Number),
    });
    expect(attackInputs).toHaveLength(1);
    expect(attackInputs[0]).toMatchObject({ providedD20: 8 });
  });
});

/**
 * The DM narrates in prose, and prose names weapons the character sheet has never heard of.
 * `weapon_id` was consumed as a hard identity claim, so "with her elven greatbow" reached
 * `getEquippedWeaponProfile`, missed, and threw `Requested weapon is not equipped` — a 422 that
 * killed the swing. An unrecognized weapon name must not be able to stop a fight.
 */
describe('a DM attack naming a weapon the character does not own', () => {
  beforeEach(() => {
    activeParticipantId = 'the-seeker';
  });

  it('resolves through the engine and logs DM_WEAPON_UNGROUNDED instead of 422-ing', async () => {
    const response = await postIntent({
      intent: {
        type: 'attack',
        actorId: 'the-seeker',
        targetId: 'the-void-maw',
        weaponId: 'elven-greatbow',
      },
      source: 'dm',
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: Record<string, unknown> };
    expect(body.result).toMatchObject({
      actorId: 'the-seeker',
      actorName: 'The Seeker',
      targetId: 'the-void-maw',
      targetName: 'The Void-Maw',
      d20: 12,
      attackBonus: 4,
      targetAC: 14,
      totalAttackRoll: 16,
      targetCondition: 'wounded',
      autoRolled: true,
      weaponResolution: {
        requested: 'elven-greatbow',
        resolved: 'Longbow',
        substituted: true,
      },
    });
    expect(attackInputs).toHaveLength(1);
    expect(trackedEvents.some((event) => event.name === 'action_refused')).toBe(false);

    const ungrounded = warnings.find((entry) => entry.event === 'DM_WEAPON_UNGROUNDED');
    expect(ungrounded).toMatchObject({
      actorId: 'the-seeker',
      requested: 'elven-greatbow',
      equipped: ['Longbow', 'Shortsword'],
    });

    // A greatbow is a bow. The substitute is the ranged weapon she owns, not the first row.
    expect(ungrounded?.resolved).toBe('Longbow');
    expect(approachWeapons[0]).toMatchObject({ name: 'Longbow', ranged: true });
    expect(attackInputs[0].weaponId).toBe('inv-longbow');
  });

  it('does not log DM_WEAPON_UNGROUNDED when the claim matches the sheet', async () => {
    const response = await postIntent({
      intent: {
        type: 'attack',
        actorId: 'the-seeker',
        targetId: 'the-void-maw',
        weaponId: 'shortsword',
      },
      source: 'dm',
    });

    expect(response.status).toBe(200);
    expect(warnings.some((entry) => entry.event === 'DM_WEAPON_UNGROUNDED')).toBe(false);
  });
});

/**
 * Approach was decided from `getEquippedWeaponProfile(actor)` — no weapon id — while resolution
 * used `intent.weaponId`. On a character carrying both a bow and a sword those are different
 * weapons, so the engine reach-checked one and rolled the other.
 */
describe('approach and resolution swing the same weapon', () => {
  beforeEach(() => {
    activeParticipantId = 'the-seeker';
  });

  it('reach-checks a shortsword attack at 5ft on a character who also has a longbow equipped', async () => {
    const response = await postIntent({
      intent: {
        type: 'attack',
        actorId: 'the-seeker',
        targetId: 'the-void-maw',
        weaponId: 'shortsword',
      },
      source: 'dm',
    });

    expect(response.status).toBe(200);

    // The longbow is first on her sheet, so the old no-argument default would have made this
    // 150ft and ranged — and walked the melee check out of existence.
    expect(approachWeapons).toHaveLength(1);
    expect(approachWeapons[0]).toMatchObject({
      name: 'Shortsword',
      ranged: false,
      normalRange: 5,
    });

    // …and resolution was handed the same row, so it cannot re-resolve to the bow.
    expect(attackInputs[0]).toMatchObject({
      attackerId: 'the-seeker',
      weaponId: 'inv-shortsword',
      attackType: 'melee',
    });
  });

  it('still defaults to the sheet order when the DM names no weapon at all', async () => {
    await postIntent({
      intent: { type: 'attack', actorId: 'the-seeker', targetId: 'the-void-maw' },
      source: 'dm',
    });

    expect(approachWeapons[0]).toMatchObject({ name: 'Longbow', ranged: true });
    expect(attackInputs[0].weaponId).toBe('inv-longbow');
    expect(warnings.some((entry) => entry.event === 'DM_WEAPON_UNGROUNDED')).toBe(false);
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

  it('logs at most 32 characters of an unknown intent type; the 422 body is unchanged (#2427)', async () => {
    const longType = `${'x'.repeat(40)}$&tail`;
    warnings.length = 0;
    const response = await postIntent({
      intent: { type: longType, actorId: 'the-seeker' },
      source: 'dm',
    });
    const body = (await response.json()) as { detail: string };
    expect(response.status).toBe(422);
    expect(body.detail).toContain(JSON.stringify(longType));
    const logged = warnings.find((entry) => entry.field === 'intent.type');
    expect(logged?.reason).toContain(JSON.stringify('x'.repeat(32)));
    expect(String(logged?.reason)).not.toContain('x'.repeat(33));
    expect(String(logged?.reason)).not.toContain('tail');
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
