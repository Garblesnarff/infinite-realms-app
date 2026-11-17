import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { HEAL_WIRE_BODY } from '../../../../../shared/test-fixtures/character-vitals-wire';

/**
 * #621 Part A: the client sends POST /v1/characters/:id/heal with `{amount}` for every heal,
 * in combat and out of it. The server picks the branch: a live encounter heals the participant
 * row, otherwise the sheet is healed. These tests post the exact client body (the shared
 * fixture) through the real Elysia route schema, and cover both branches (AGENTS.md section 4).
 */

const findLiveParticipant = mock(
  async (..._args: unknown[]): Promise<null | { participantId: string; encounterId: string }> =>
    null,
);
const combatHealDamage = mock(async (..._args: unknown[]) => ({}));
const vitalsHeal = mock(async (..._args: unknown[]) => ({}));
const getVitals = mock(async (..._args: unknown[]) => ({
  currentHitPoints: 27,
  temporaryHitPoints: 0,
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-key',
    WORKOS_CLIENT_ID: 'test-client-id',
  },
}));
mock.module('../../../lib/user-plan.js', () => ({
  resolveUserPlanStrict: async () => 'pro',
  resolveUserPlan: async () => 'pro',
}));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({
    user: { userId: 'user-1', email: 'user@example.test', plan: 'free' },
    error: null,
  }),
}));
mock.module('../../../lib/db.js', () => ({ sql: async () => [] }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));
mock.module('../../../../../db/client', () => ({ db: {} }));
mock.module('../../../../../db/schema/index', () => ({
  spells: { id: 'id', name: 'name' },
  characters: {},
  characterSpells: {},
  characterEquipment: {},
  inventoryItems: {},
  characterSpellSlots: {},
  spellSlotUsageLog: {},
  characterSubclasses: {},
}));
mock.module('../../../services/campaign-service.js', () => ({ CampaignService: {} }));
mock.module('../../../services/character/character-spell-service.js', () => ({
  CharacterSpellService: {},
}));
mock.module('../../../services/character-service.js', () => ({
  CharacterService: { getById: async () => ({ id: 'character-1' }) },
}));
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: { heal: vitalsHeal, getVitals },
}));
mock.module('../../../services/combat-hp-service.js', () => ({
  CombatHPService: { healDamage: combatHealDamage },
}));
mock.module('../../../services/subclass-service.js', () => ({
  SubclassService: {
    getSubclassChoiceLevel: () => 3,
    setSubclass: async () => {},
  },
}));
mock.module('../../../services/combat/non-attack-damage.js', () => ({
  applyNonAttackDamage: mock(async () => ({
    vitals: { currentHitPoints: 22, temporaryHitPoints: 0 },
    engineLines: [],
  })),
  findLiveParticipant,
}));

const { charactersRoutes } = await import('../characters.js');
const app = new Elysia().use(charactersRoutes);

function postHeal(body: string): Promise<Response> {
  return app.handle(
    new Request('http://localhost/v1/characters/character-1/heal', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
      },
      body,
    }),
  );
}

describe('character heal route wire body (#621 Part A)', () => {
  beforeEach(() => {
    findLiveParticipant.mockClear();
    combatHealDamage.mockClear();
    vitalsHeal.mockClear();
    getVitals.mockClear();
  });

  it('out of combat: heals the sheet and returns the server vitals', async () => {
    findLiveParticipant.mockImplementationOnce(async () => null);

    const response = await postHeal(JSON.stringify(HEAL_WIRE_BODY));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ currentHitPoints: 27, temporaryHitPoints: 0 });
    expect(vitalsHeal).toHaveBeenCalledWith('character-1', 'user-1', HEAL_WIRE_BODY.amount);
    expect(combatHealDamage).not.toHaveBeenCalled();
  });

  it('in combat: heals the live participant row, not the sheet', async () => {
    findLiveParticipant.mockImplementationOnce(async () => ({
      participantId: 'participant-1',
      encounterId: 'encounter-1',
    }));

    const response = await postHeal(JSON.stringify(HEAL_WIRE_BODY));

    expect(response.status).toBe(200);
    expect(combatHealDamage).toHaveBeenCalledWith(
      'participant-1',
      'encounter-1',
      HEAL_WIRE_BODY.amount,
      'healing',
      'user-1',
    );
    expect(vitalsHeal).not.toHaveBeenCalled();
  });

  it('rejects a negative amount at the schema boundary', async () => {
    const response = await postHeal(JSON.stringify({ amount: -5 }));

    expect(response.status).toBe(422);
    expect(vitalsHeal).not.toHaveBeenCalled();
    expect(combatHealDamage).not.toHaveBeenCalled();
  });
});
