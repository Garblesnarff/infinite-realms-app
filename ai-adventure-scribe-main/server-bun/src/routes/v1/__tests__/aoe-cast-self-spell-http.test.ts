/* eslint-disable max-lines -- one reproduction of the #902 report through the real route, the real
   intent gateway, and the real spell resolution, sharing one board and one set of data mocks. */
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type { MapEntity, TacticalMap } from '../../../tactical/types.js';

/**
 * #902 part 2: "I cast Detect Magic" was refused with "Detect Magic has no area of effect —
 * name its target". Detect Magic's range is Self: there is no target to name. The refusal
 * lived in the AoE-cast route's prepare step, which demanded an area of effect from every
 * spell routed to it, and behind it the combat engine refused any spell with no attack
 * roll, save, or damage.
 *
 * Everything below the route is real except the storage: the aoe-cast service, the intent
 * gateway (reference resolution, turn check), `CombatAttackService.resolveSpellAttack`
 * (assessment, slot spend, concentration start). Only rows, dice, and the concentration
 * table are faked — the concentration fake records its writes so the test can see the row
 * the sheet's chip reads.
 */
const SESSION_ID = '0a1b2c3d-0000-4000-8000-000000000001';
const ENCOUNTER_ID = '0a1b2c3d-0000-4000-8000-000000000002';
const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const GOLDWHISK_ID = '779792b2-aef0-4288-be43-19aba2530eba';
const IMP_ID = '5d1e0a44-1111-4222-8333-444444444444';
const CHARACTER_ID = '2733e680-0000-4000-8000-000000000003';
const USER_ID = 'user_owner';

const slots = new Map<number, number>();
const hp = new Map<string, number>();
const concentrationStarts: Array<{
  characterId: string;
  spellName: string;
  spellId: string | null;
  targetParticipantId: string | null;
}> = [];

const noop = () => {};
const silentLogger = {
  debug: noop,
  info: noop,
  error: noop,
  warn: noop,
  child: () => silentLogger,
};
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../lib/env.js', () => ({
  env: { WORKOS_CLIENT_ID: 'test-client', NODE_ENV: 'test' },
}));
mock.module('../../../lib/logger.js', () => ({
  logger: silentLogger,
  combatLogger: silentLogger,
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) =>
    request.headers.get('authorization') === 'Bearer valid-token'
      ? { user: { userId: USER_ID, email: 'owner@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' },
}));

const participant = (id: string, name: string, participantType: 'player' | 'monster') => ({
  id,
  name,
  participantType,
  characterId: participantType === 'player' ? CHARACTER_ID : null,
  isActive: true,
  maxHp: participantType === 'player' ? 7 : 40,
  armorClass: participantType === 'player' ? 11 : 12,
  encounterId: ENCOUNTER_ID,
  damageImmunities: [],
  damageResistances: [],
  damageVulnerabilities: [],
  encounter: { sessionId: SESSION_ID, currentRound: 4 },
  get status() {
    return {
      currentHp: hp.get(id) ?? 0,
      isConscious: (hp.get(id) ?? 0) > 0,
      isDead: false,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    };
  },
});
const roster = () => [
  participant(APPRENTICE_ID, 'The Apprentice', 'player'),
  participant(GOLDWHISK_ID, 'Headmaster Goldwhisk', 'monster'),
  participant(IMP_ID, 'Kitchen Imp', 'monster'),
];

mock.module('../../../services/combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => ({ id: ENCOUNTER_ID, sessionId: SESSION_ID }),
    getCombatState: async () => ({
      encounter: { id: ENCOUNTER_ID, sessionId: SESSION_ID, status: 'active', version: 7 },
      participants: roster(),
      turnOrder: [],
      currentParticipant: roster()[0],
      participantSizes: {},
    }),
    endCombat: async () => {},
  },
}));

// The Apprentice as the premade seed writes her (INT 16, Wizard 1); her sheet carries the
// spells these tests cast, the way prepareSpellCast's sheet check expects.
let apprenticeSpellIds: string[] = [];
const profile = (entity: { id: string }) =>
  entity.id === APPRENTICE_ID
    ? {
        level: 1,
        className: 'Wizard',
        savingThrowProficiencies: ['int', 'wis'],
        scores: { str: 8, dex: 12, con: 12, int: 16, wis: 12, cha: 10 },
        saveBonuses: {},
        spellIds: apprenticeSpellIds,
      }
    : {
        level: 1,
        className: null,
        savingThrowProficiencies: [],
        scores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        saveBonuses: {},
        spellIds: [],
      };
mock.module('../../../services/combat/data-access.js', () => ({
  remainingSpellSlots: async () => null,
  listHealingConsumables: async () => [],
  getParticipantWithStats: async (id: string) => ({
    participant: roster().find((p) => p.id === id),
    stats: null,
  }),
  getParticipantsWithStatsBatch: async (ids: string[]) =>
    new Map(ids.map((id) => [id, { participant: roster().find((p) => p.id === id), stats: null }])),
  getParticipantAbilityProfile: async (entity: { id: string }) => profile(entity),
  getActiveConditionNames: async () => [],
  listEquippedWeaponProfiles: async () => [],
  listCarriedWeaponProfiles: async () => [],
  getEquippedWeaponProfile: async () => null,
  getWeaponAttack: async () => null,
  getCharacterWeapons: async () => [],
  getCreatureStats: async () => null,
  getCreatureStatsBatch: async () => new Map(),
  createWeaponAttack: async () => null,
  monsterAttackSource: () => 'none',
  claimEncounterVersion: async () => {},
  verifyCharacterOwnership: async () => {},
  verifyEncounterAccess: async () => {},
  getParticipantInEncounter: async () => null,
  countStandingMooks: async () => 0,
}));
mock.module('../../../services/combat/combat-turn-resources.js', () => ({
  consumeAction: async () => {},
  claimTurnAction: async () => {},
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
  claimTurnVersion: async () => 1,
  // #975: session-service imports withPreservedActionSurgeMark (the armed
  // Action Surge mark survives whole-blob session_state writes) and the
  // fighter-features resolver imports readActionSurgeMark. No session in this
  // suite arms a surge, so the incoming blob passes through unchanged and the
  // mark reads as absent, exactly as the real helpers behave with no mark.
  withPreservedActionSurgeMark: (_session: unknown, nextState: unknown) => nextState,
  readActionSurgeMark: () => null,
  // The fighter-features resolver arms the mark through this name; no AoE
  // case in this suite declares Action Surge, so it is never called — it
  // exists so the real resolver's imports resolve against this mock.
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
  claimTurnReactionAndResolve: async (
    _participantId: string,
    _encounterId: string,
    resolve: () => Promise<unknown>,
  ) => resolve(),
}));
mock.module('../../../services/combat-hp-service.js', () => ({
  CombatHPService: {
    applyDamage: async (id: string, _encounterId: string, options: { damageAmount: number }) => {
      const next = Math.max(0, (hp.get(id) ?? 0) - Number(options.damageAmount));
      hp.set(id, next);
      return {
        damageDealt: Number(options.damageAmount),
        newCurrentHp: next,
        isConscious: next > 0,
        isDead: false,
      };
    },
    healDamage: async () => ({}),
  },
}));
mock.module('../../../services/combat-initiative-service.js', () => ({
  CombatInitiativeService: {
    getCurrentTurn: async () => roster()[0],
    advanceTurn: async () => ({ currentParticipant: roster()[1] }),
  },
}));
mock.module('../../../services/spell-slots-service.js', () => ({
  SpellSlotsService: {
    useSpellSlot: async (input: { slotLevelUsed: number; characterId: string }) => {
      if (input.characterId !== CHARACTER_ID) throw new Error('wrong character');
      const left = slots.get(input.slotLevelUsed) ?? 0;
      if (left < 1) throw new Error(`No level ${input.slotLevelUsed} spell slots remaining`);
      slots.set(input.slotLevelUsed, left - 1);
      return { success: true, remainingSlots: left - 1 };
    },
  },
}));
mock.module('../../../services/combat/npc-provocation.js', () => ({
  markPlayerDamageProvocation: async () => [],
}));
mock.module('../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../services/combat/combat-events.js', () => ({ trackCombatEvent: noop }));
// The concentration table, faked as a recording store with the module's whole surface, so
// the test sees the row a cast writes (the row the sheet's Concentrating chip renders).
mock.module('../../../services/combat/concentration-service.js', () => ({
  startConcentration: async (
    characterId: string,
    spell: { name: string; id?: string },
    targetId?: string | null,
  ) => {
    concentrationStarts.push({
      characterId,
      spellName: spell.name,
      spellId: spell.id ?? null,
      targetParticipantId: targetId ?? null,
    });
  },
  getConcentration: async (characterId: string) =>
    [...concentrationStarts].reverse().find((row) => row.characterId === characterId) ?? null,
  getConcentrationTargetingParticipant: async (participantId: string) =>
    [...concentrationStarts]
      .reverse()
      .find((row) => row.targetParticipantId === participantId) ?? null,
  dropConcentration: async () => null,
  checkConcentrationOnDamage: async () => ({ hadConcentration: false, saveTriggered: false }),
  describeConcentrationBroken: (name: string, spellName: string) =>
    `${name} loses concentration on ${spellName}.`,
  describeConcentrationMaintained: (name: string, spellName: string) =>
    `${name} maintains concentration on ${spellName}.`,
  concentrationSaveDc: (damage: number) => Math.max(10, Math.floor(damage / 2)),
}));

let board: TacticalMap;
mock.module('../../../services/combat/tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => board,
  loadLatestTacticalMapRow: async () => ({ rowId: 'row', state: board, active: true }),
  saveTacticalMap: async () => {},
  saveTacticalMapRow: async () => {},
  deactivateTacticalMap: async () => {},
}));

const { createRequestPipelineApp } = await import('../../../http-pipeline.js');
const { requireAuth } = await import('../../../middleware/auth.js');
const { createTacticalMapRoutes } = await import('../tactical-maps.js');
const { assignEntitySlugs } = await import('../../../tactical/identity.js');

const app = createRequestPipelineApp().use(
  createTacticalMapRoutes({
    auth: requireAuth,
    sessionOwnership: (async () => ({
      success: true as const,
      session: { id: SESSION_ID },
    })) as never,
  }),
);

const entity = (id: string, name: string, x: number, type: 'pc' | 'monster'): MapEntity => ({
  id,
  name,
  x,
  y: 4,
  size: 'medium',
  type,
  speedFeet: 30,
  movementRemaining: 30,
});

function freshBoard(): TacticalMap {
  const entities = assignEntitySlugs([
    entity(APPRENTICE_ID, 'The Apprentice', 2, 'pc'),
    entity(GOLDWHISK_ID, 'Headmaster Goldwhisk', 3, 'monster'),
    entity(IMP_ID, 'Kitchen Imp', 4, 'monster'),
  ]);
  return {
    id: 'map',
    sessionId: SESSION_ID,
    width: 12,
    height: 9,
    round: 4,
    sceneDescription: 'the feast hall',
    cells: Array.from({ length: 9 }, () =>
      Array.from({ length: 12 }, () => ({
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

const castArea = (body: Record<string, unknown>) =>
  app.handle(
    new Request(`http://localhost/v1/sessions/${SESSION_ID}/tactical-map/aoe-cast`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
        'x-request-id': 'req-902-self-spell',
      },
      body: JSON.stringify({ phase: 'propose', direction: null, ...body }),
    }),
  );

type CastResponse = {
  delta?: { actorId: string; targets: Array<{ entityId: string; saved: boolean | null }> };
  result?: { results?: Array<Record<string, unknown>> };
  error?: string;
  details?: { reason?: string };
};

const random = spyOn(Math, 'random');

beforeEach(() => {
  board = freshBoard();
  slots.clear();
  slots.set(1, 2);
  hp.clear();
  hp.set(APPRENTICE_ID, 5);
  hp.set(GOLDWHISK_ID, 40);
  hp.set(IMP_ID, 40);
  concentrationStarts.length = 0;
  apprenticeSpellIds = ['detect-magic', 'expeditious-retreat', 'fire-bolt', 'false-life'];
  random.mockReturnValue(0.5);
});

describe('#902: a Self-range spell casts with no target named', () => {
  it('Detect Magic resolves on the caster: slot spent, concentration started, nobody damaged', async () => {
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'detect-magic',
      // The DM's cast declaration names the caster's own cell as the origin; no target.
      origin: { x: 2, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect({ status: response.status, error: payload.error }).toEqual({
      status: 200,
      error: undefined,
    });
    expect(payload.delta?.actorId).toBe(APPRENTICE_ID);
    expect(payload.delta?.targets.map((target) => target.entityId)).toEqual([APPRENTICE_ID]);
    expect(payload.result?.results).toHaveLength(1);
    expect(payload.result?.results?.[0]).toMatchObject({
      spellName: 'Detect Magic',
      selfCast: true,
      hit: true,
      finalDamage: 0,
    });
    expect(slots.get(1)).toBe(1);
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
    expect(hp.get(IMP_ID)).toBe(40);
    // The concentration row the sheet's chip renders from.
    expect(concentrationStarts).toEqual([
      {
        characterId: CHARACTER_ID,
        spellName: 'Detect Magic',
        spellId: 'detect-magic',
        targetParticipantId: APPRENTICE_ID,
      },
    ]);
  });

  it('the rule is the range and the concentration ledger, not the name: Expeditious Retreat self-casts the same way', async () => {
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'expeditious-retreat',
      origin: { x: 2, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(200);
    expect(payload.result?.results?.[0]).toMatchObject({
      spellName: 'Expeditious Retreat',
      selfCast: true,
      finalDamage: 0,
    });
    expect(slots.get(1)).toBe(1);
    expect(concentrationStarts.map((row) => row.spellId)).toEqual(['expeditious-retreat']);
  });

  it('control: a Self spell the engine does not resolve refuses as itself, never as "name its target"', async () => {
    // False Life is Self-range but not concentration: its temporary hit points are state
    // the acknowledgment does not write, so the cast stays refused — with a message that
    // describes the actual problem instead of demanding a target a Self spell cannot have.
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'false-life',
      origin: { x: 2, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(422);
    expect(payload.details?.reason).toBe('self_spell_not_resolved');
    expect(payload.error).toContain('False Life is cast on yourself');
    expect(payload.error).not.toContain('name its target');
    expect(slots.get(1)).toBe(2);
    expect(concentrationStarts).toEqual([]);
  });

  it('control: a spell that genuinely needs a target still refuses without one', async () => {
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'fire-bolt',
      origin: { x: 3, y: 4 },
      slotLevel: null,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(422);
    expect(payload.details?.reason).toBe('no_area_of_effect');
    expect(payload.error).toBe(
      'Fire Bolt has no area of effect — name its target and cast it again',
    );
    expect(slots.get(1)).toBe(2);
    expect(concentrationStarts).toEqual([]);
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
  });
});
