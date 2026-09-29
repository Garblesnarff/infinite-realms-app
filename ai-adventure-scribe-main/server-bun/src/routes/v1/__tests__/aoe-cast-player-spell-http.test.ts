/* eslint-disable max-lines -- one reproduction of run M7 round 4 through the real route, the real
   intent gateway, and the real spell resolution, sharing one board and one set of data mocks. */
import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

import type { MapEntity, TacticalMap } from '../../../tactical/types.js';

/**
 * Run M7 round 4 (#2304): the sheet's Cast sent "I cast Burning Hands [spell_id=burning-hands,
 * spell_level=level 1]." The DM declared it as an area spell, the client proposed it to this
 * route with the digest slug `the-apprentice` as the caster, and the route answered 422 "Casting
 * entity is not on the tactical map" — an exact-id `find` against a board keyed on participant
 * uuids. No engine line, no slot spent, and the DM narrated the previous turn's acid instead.
 *
 * Everything below the route is real except the storage: the aoe-cast service, the intent
 * gateway (reference resolution, turn check), `CombatAttackService.resolveSpellAttack` (save DC,
 * save roll, damage, half on a save, slot spend). Only rows and dice are faked.
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
const loggedWarnings: Array<Record<string, unknown>> = [];

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
  logger: {
    ...silentLogger,
    warn: (data: unknown) => {
      if (data && typeof data === 'object') loggedWarnings.push(data as Record<string, unknown>);
    },
  },
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

// The Apprentice as the premade seed writes her (INT 16, Wizard 1) and every area spell the
// player combat scope admits, so the per-spell walk below casts from her own sheet.
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
        // The imp always makes its save, so every cast shows both branches: full and half.
        saveBonuses: entity.id === IMP_ID ? { dex: 30, con: 30, wis: 30, str: 30 } : {},
        spellIds: [],
      };
mock.module('../../../services/combat/data-access.js', () => ({
  getParticipantWithStats: async (id: string) => ({
    participant: roster().find((p) => p.id === id),
    stats: null,
  }),
  getParticipantsWithStatsBatch: async (ids: string[]) =>
    new Map(ids.map((id) => [id, { participant: roster().find((p) => p.id === id), stats: null }])),
  getParticipantAbilityProfile: async (entity: { id: string }) => profile(entity),
  getActiveConditionNames: async () => [],
  listEquippedWeaponProfiles: async () => [],
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
// The character's slots, as the sheet shows them: 2/2 at level 1 before the cast.
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
const { PLAYER_COMBAT_SPELL_IDS, getSpellById } = await import('../../../data/spellData.js');
// The client's own transcript formatter: the line the player reads is built from this response.
const transcriptModule = '../../../../../src/services/combat/combat-outcome-transcript';
const { formatCombatEngineOutcome } = (await import(transcriptModule)) as {
  formatCombatEngineOutcome(action: Record<string, unknown>, value: unknown): string | null;
};

// Mounted on the real request pipeline, so the error body, the request id, and the refusal log
// are the ones production produces.
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
  // The Apprentice at (2,4), Goldwhisk adjacent at (3,4), the imp one cell further at (4,4):
  // both inside a 15-foot cone pointed east.
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
        'x-request-id': 'req-m7-round-4',
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

/** The engine line the client prints, built from the route's answer the way the client builds it. */
const engineLine = (payload: CastResponse, spellId: string) =>
  formatCombatEngineOutcome(
    {
      actor_id: payload.delta!.actorId,
      action_type: 'cast_spell',
      target_ids: payload.delta!.targets.map((target) => target.entityId),
      spell_id: spellId,
    },
    payload.result,
  );

const random = spyOn(Math, 'random');

beforeEach(() => {
  board = freshBoard();
  slots.clear();
  slots.set(1, 2);
  hp.clear();
  hp.set(APPRENTICE_ID, 5);
  hp.set(GOLDWHISK_ID, 40);
  hp.set(IMP_ID, 40);
  loggedWarnings.length = 0;
  apprenticeSpellIds = ['acid-splash', 'chill-touch', 'burning-hands'];
  // Every d20 lands on 11 and every damage die on its middle face.
  random.mockReturnValue(0.5);
});

describe('run M7 round 4: the sheet-Cast Burning Hands at level 1', () => {
  it('resolves through the route as a DEX save for fire damage, half on a save, and spends one slot (2 → 1)', async () => {
    const response = await castArea({
      // The digest slug the DM copies — the token that was refused in production.
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      // The DM aimed the cone at Goldwhisk's cell.
      origin: { x: 3, y: 4 },
      slotLevel: 1,
      // The sheet's Cast button, forwarded to the intent gateway (#2305).
      actionOrigin: 'sheet_cast',
    });
    const payload = (await response.json()) as CastResponse;

    expect({ status: response.status, error: payload.error }).toEqual({
      status: 200,
      error: undefined,
    });
    expect(payload.delta?.actorId).toBe(APPRENTICE_ID);
    expect(payload.delta?.targets.map((target) => target.entityId).sort()).toEqual(
      [GOLDWHISK_ID, IMP_ID].sort(),
    );
    const outcomes = payload.result?.results ?? [];
    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome).toMatchObject({
        spellName: 'Burning Hands',
        saveAbility: 'dexterity',
        saveDC: 13,
        damageType: 'fire',
      });
    }
    const byTarget = new Map(
      payload.delta!.targets.map((target, index) => [target.entityId, outcomes[index]]),
    );
    // 3d6 on the middle face = 12. Goldwhisk (DEX +0) rolls 11 vs DC 13 and takes all of it;
    // the imp saves and takes half, rounded down.
    expect(byTarget.get(GOLDWHISK_ID)).toMatchObject({ saved: false, finalDamage: 12 });
    expect(byTarget.get(IMP_ID)).toMatchObject({ saved: true, finalDamage: 6 });
    expect(hp.get(GOLDWHISK_ID)).toBe(28);
    expect(hp.get(IMP_ID)).toBe(34);
    expect(slots.get(1)).toBe(1);

    const line = engineLine(payload, 'burning-hands');
    expect(line).toContain('DEX save 11 vs DC 13 — FAIL. 12 fire damage.');
    expect(line).toContain('— PASS. 6 fire damage.');
    expect(line?.match(/Burning Hands/g)).toHaveLength(2);
  });

  it('accepts the participant uuid and the display name as the caster too', async () => {
    for (const actorId of [APPRENTICE_ID, 'The Apprentice']) {
      const response = await castArea({
        actorId,
        spellId: 'burning-hands',
        origin: { x: 2, y: 4 },
        direction: { x: 1, y: 0 },
        slotLevel: 1,
      });
      expect(response.status).toBe(200);
    }
    expect(slots.get(1)).toBe(0);
  });

  it('refuses a cone that catches nobody with a reason the player can act on, and keeps the slot', async () => {
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      // Aimed west, away from everyone.
      origin: { x: 1, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(422);
    expect(payload.details?.reason).toBe('aoe_no_targets');
    expect(payload.error).toContain('move within 15 feet of a target and cast it again');
    expect(slots.get(1)).toBe(2);
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
    // The reason is in the server log now, not only in a response body nginx never records,
    // and it carries the request id the pipeline hands back to the client.
    expect(response.headers.get('x-request-id')).toBe('req-m7-round-4');
    expect(loggedWarnings.find((entry) => entry.event === 'AOE_CAST_REFUSED')).toMatchObject({
      requestId: 'req-m7-round-4',
      sessionId: SESSION_ID,
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      details: { reason: 'aoe_no_targets' },
    });
  });

  it('refuses a cone aimed from the caster cell with no direction, saying to name the aim', async () => {
    // origin = the caster's own cell and direction null: the template would be empty.
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      origin: { x: 2, y: 4 },
      direction: null,
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(422);
    expect(payload.details?.reason).toBe('aoe_no_direction');
    expect(payload.error).toContain('say which way you aim it');
    expect(slots.get(1)).toBe(2);
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
  });

  it('refuses a player area spell no player input produced, before any slot or damage', async () => {
    for (const actionOrigin of ['dm', 'repair']) {
      const response = await castArea({
        actorId: 'the-apprentice',
        spellId: 'burning-hands',
        origin: { x: 3, y: 4 },
        slotLevel: 1,
        actionOrigin,
      });
      const payload = (await response.json()) as CastResponse;

      expect(response.status).toBe(422);
      expect(payload.details?.reason).toBe('player_action_without_input');
    }
    expect(slots.get(1)).toBe(2);
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
    expect(loggedWarnings.filter((entry) => entry.event === 'AOE_CAST_REFUSED')).toHaveLength(2);
  });

  it('refuses a caster the board does not have and names who is on it', async () => {
    const response = await castArea({
      actorId: 'the-sorcerer',
      spellId: 'burning-hands',
      origin: { x: 3, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBe(422);
    expect(payload.details?.reason).toBe('caster_not_on_map');
    expect(payload.error).toContain('the-apprentice');
    expect(slots.get(1)).toBe(2);
  });

  it('refuses a level-1 cast with no slot left, through the engine, without damage', async () => {
    slots.set(1, 0);
    const response = await castArea({
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      origin: { x: 3, y: 4 },
      slotLevel: 1,
    });
    const payload = (await response.json()) as CastResponse;

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(payload.error).toBeTruthy();
    expect(hp.get(GOLDWHISK_ID)).toBe(40);
  });
});

const areaSpells = PLAYER_COMBAT_SPELL_IDS.map((id) => getSpellById(id)).filter(
  (spell): spell is NonNullable<ReturnType<typeof getSpellById>> => !!spell?.areaOfEffect,
);

describe('every area spell in the player combat scope resolves through the route', () => {
  it('has at least Burning Hands in scope', () => {
    expect(areaSpells.map((spell) => spell.id)).toContain('burning-hands');
  });

  it.each(areaSpells.map((spell) => [spell.id, spell] as const))(
    '%s: one engine line per caught creature, its save, its damage type, and the slot',
    async (spellId, spell) => {
      apprenticeSpellIds = [spellId];
      const slotLevel = spell.level > 0 ? spell.level : null;
      if (slotLevel) slots.set(slotLevel, 2);
      const response = await castArea({
        actorId: 'the-apprentice',
        spellId,
        origin: { x: 3, y: 4 },
        slotLevel,
      });
      const payload = (await response.json()) as CastResponse;

      expect(response.status).toBe(200);
      const line = engineLine(payload, spellId) ?? '';
      expect(line).toContain(spell.name);
      if (spell.saveAbility)
        expect(line).toContain(`${spell.saveAbility.toUpperCase().slice(0, 3)} save`);
      if (spell.damageType) expect(line).toContain(`${spell.damageType} damage`);
      if (slotLevel) expect(slots.get(slotLevel)).toBe(1);
    },
  );
});
