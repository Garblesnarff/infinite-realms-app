/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real-request boundary checks for combat actions routes.
 * Independent of DATABASE_URL and external services.
 */
import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

class MockRowList<T> extends Array<T> {
  static get [Symbol.species]() {
    return Array;
  }
}

// Mock database and env modules before other imports load them
mock.module('../../../lib/db.js', () => ({ sql: async () => new MockRowList() }));
mock.module('../../../lib/env.js', () => ({ env: { WORKOS_CLIENT_ID: 'test-client' } }));

// Mock auth module
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer valid-user-token') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

// Mock logger module
mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

// Mock helpers for verification using absolute resolved path
const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifyEncounterOwnership: async (encounterId: string, _userId: string) => {
    if (encounterId === 'valid-encounter-id') {
      return { success: true, encounter: { currentRound: 1 } };
    }
    return { success: false, error: { status: 404, message: 'Encounter not found' } };
  },
  verifySessionOwnership: async (_sessionId: string, _userId: string) => {
    return { success: true };
  },
}));

// Mock character service
mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async (characterId: string, _userId: string) => {
      if (characterId === 'valid-character-id') {
        return { id: 'valid-character-id', name: 'Valid Hero' };
      }
      return null;
    },
  },
}));

// Mock combat attack service
let lastResolveAttackArgs: any = null;
let lastResolveSpellAttackArgs: any = null;
let lastCreateWeaponAttackArgs: any = null;

mock.module('../../../services/combat-attack-service.js', () => {
  return {
    CombatAttackService: class {
      resolveAttack(...args: any[]) {
        lastResolveAttackArgs = args;
        return { finalDamage: 10 };
      }
      resolveSpellAttack(...args: any[]) {
        lastResolveSpellAttackArgs = args;
        return { results: [{ finalDamage: 15 }] };
      }
      getCharacterWeapons(characterId: string, _userId: string) {
        return [{ id: 'weapon-1', name: 'Sword', characterId }];
      }
      createWeaponAttack(...args: any[]) {
        lastCreateWeaponAttackArgs = args;
        return { id: 'new-weapon-1', name: args[0].name };
      }
    },
  };
});

// Mock sync service and events
mock.module('../../../services/combat/combat-sync-service.js', () => ({
  publishCombatState: async () => {},
}));
mock.module('../../../services/combat/combat-events.js', () => ({
  trackCombatEvent: () => {},
}));

const { actionRoutes } = await import('../combat/actions.js');

const app = new Elysia().use(actionRoutes);

describe('v1 combat action routes API boundaries', () => {
  it('denies unauthenticated requests on all routes', async () => {
    const r1 = await app.handle(
      new Request('http://localhost/valid-encounter-id/attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(r1.status).toBe(401);

    const r2 = await app.handle(
      new Request('http://localhost/valid-encounter-id/spell-attack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(r2.status).toBe(401);

    const r3 = await app.handle(
      new Request('http://localhost/characters/valid-character-id/attacks')
    );
    expect(r3.status).toBe(401);

    const r4 = await app.handle(
      new Request('http://localhost/characters/valid-character-id/attacks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    expect(r4.status).toBe(401);
  });

  it('denies unauthorized encounter access', async () => {
    const r1 = await app.handle(
      new Request('http://localhost/invalid-encounter-id/attack', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          attackerId: 'pc-1',
          targetId: 'npc-1',
          expectedVersion: 1,
        }),
      })
    );
    expect(r1.status).toBe(404);

    const r2 = await app.handle(
      new Request('http://localhost/invalid-encounter-id/spell-attack', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          casterId: 'pc-1',
          targetIds: ['npc-1'],
          spellName: 'Fireball',
          expectedVersion: 1,
        }),
      })
    );
    expect(r2.status).toBe(404);
  });

  it('denies unauthorized character access', async () => {
    const r1 = await app.handle(
      new Request('http://localhost/characters/invalid-character-id/attacks', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );
    expect(r1.status).toBe(404);

    const r2 = await app.handle(
      new Request('http://localhost/characters/invalid-character-id/attacks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          name: 'Shortbow',
          damageDice: '1d6',
          damageType: 'piercing',
          attackBonus: 4,
        }),
      })
    );
    expect(r2.status).toBe(404);
  });

  it('allows resolveAttack when authenticated and authorized', async () => {
    const response = await app.handle(
      new Request('http://localhost/valid-encounter-id/attack', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          attackerId: 'pc-1',
          targetId: 'npc-1',
          expectedVersion: 1,
        }),
      })
    );

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.finalDamage).toBe(10);
    expect(lastResolveAttackArgs).not.toBeNull();
    expect(lastResolveAttackArgs[0]).toBe('valid-encounter-id');
    expect(lastResolveAttackArgs[1].attackerId).toBe('pc-1');
  });

  it('allows resolveSpellAttack when authenticated and authorized', async () => {
    const response = await app.handle(
      new Request('http://localhost/valid-encounter-id/spell-attack', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          casterId: 'pc-1',
          targetIds: ['npc-1'],
          spellName: 'Fireball',
          expectedVersion: 1,
        }),
      })
    );

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.results[0].finalDamage).toBe(15);
    expect(lastResolveSpellAttackArgs).not.toBeNull();
    expect(lastResolveSpellAttackArgs[0]).toBe('valid-encounter-id');
  });

  it('allows listing character weapons when authenticated and authorized', async () => {
    const response = await app.handle(
      new Request('http://localhost/characters/valid-character-id/attacks', {
        headers: {
          'authorization': 'Bearer valid-user-token',
        },
      })
    );

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.attacks).toBeDefined();
    expect(body.attacks[0].name).toBe('Sword');
  });

  it('allows creating character weapons when authenticated and authorized', async () => {
    const response = await app.handle(
      new Request('http://localhost/characters/valid-character-id/attacks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer valid-user-token',
        },
        body: JSON.stringify({
          name: 'Shortbow',
          damageDice: '1d6',
          damageType: 'piercing',
          attackBonus: 4,
        }),
      })
    );

    expect(response.status).toBe(201);
    const body: any = await response.json();
    expect(body.attack).toBeDefined();
    expect(body.attack.name).toBe('Shortbow');
    expect(lastCreateWeaponAttackArgs).not.toBeNull();
  });
});
