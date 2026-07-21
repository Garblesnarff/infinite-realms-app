/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatAction,
} from '../combat-action-executor';

// Mock getAuthHeaders
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

describe('combat-action-executor', () => {
  const encounterId = 'encounter-123';
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  describe('executeAuthoritativeCombatIntent', () => {
    it('should execute combat intent directly when expectedVersion is provided', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: 5 };
      const mockResponse = { ok: true, json: async () => ({ result: 'dash-success' }) };
      (globalThis.fetch as any).mockResolvedValue(mockResponse);

      const result = await executeAuthoritativeCombatIntent(encounterId, intent, 'player', 12345);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
          }),
          body: JSON.stringify({ intent, source: 'player', dmStartedAt: 12345 }),
        })
      );
      expect(result).toBe('dash-success');
    });

    it('should fetch the combat status first if expectedVersion is undefined', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: undefined };

      const statusResponse = {
        ok: true,
        json: async () => ({ encounter: { version: 10 } }),
      };
      const intentResponse = {
        ok: true,
        json: async () => ({ result: 'dash-success-fetched-version' }),
      };

      (globalThis.fetch as any)
        .mockResolvedValueOnce(statusResponse)
        .mockResolvedValueOnce(intentResponse);

      const result = await executeAuthoritativeCombatIntent(encounterId, intent, 'dm');

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8888/v1/combat/encounter-123/status',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        })
      );
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            intent: { ...intent, expectedVersion: 10 },
            source: 'dm',
            dmStartedAt: undefined,
          }),
        })
      );
      expect(result).toBe('dash-success-fetched-version');
    });

    it('should fallback to expectedVersion 1 if status response does not contain encounter or version', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: undefined };

      const statusResponse = {
        ok: true,
        json: async () => ({}), // missing encounter/version
      };
      const intentResponse = {
        ok: true,
        json: async () => ({ result: 'dash-success-fallback-version' }),
      };

      (globalThis.fetch as any)
        .mockResolvedValueOnce(statusResponse)
        .mockResolvedValueOnce(intentResponse);

      const result = await executeAuthoritativeCombatIntent(encounterId, intent);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: JSON.stringify({
            intent: { ...intent, expectedVersion: 1 },
            source: 'player',
            dmStartedAt: undefined,
          }),
        })
      );
      expect(result).toBe('dash-success-fallback-version');
    });

    it('should throw an error if status check fails when expectedVersion is undefined', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: undefined };

      const statusResponse = {
        ok: false,
        status: 404,
      };

      (globalThis.fetch as any).mockResolvedValue(statusResponse);

      await expect(executeAuthoritativeCombatIntent(encounterId, intent)).rejects.toThrow(
        'Combat state unavailable (404)'
      );
    });

    it('should throw an error if the intent response is not ok', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: 3 };

      const intentResponse = {
        ok: false,
        status: 400,
        json: async () => ({ error: 'Invalid actor state' }),
      };

      (globalThis.fetch as any).mockResolvedValue(intentResponse);

      await expect(executeAuthoritativeCombatIntent(encounterId, intent)).rejects.toThrow(
        'Invalid actor state'
      );
    });

    it('should throw a fallback error message if response is not ok and json parsing fails or is empty', async () => {
      const intent = { type: 'dash' as const, actorId: 'actor-1', expectedVersion: 3 };

      const intentResponse = {
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('JSON parse error');
        },
      };

      (globalThis.fetch as any).mockResolvedValue(intentResponse);

      await expect(executeAuthoritativeCombatIntent(encounterId, intent)).rejects.toThrow(
        'Combat action rejected (500)'
      );
    });
  });

  describe('executeStructuredCombatAction', () => {
    it('should handle attack actions correctly', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'attack' as const,
        target_ids: ['target-1'],
        weapon_id: 'weapon-longbow',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };

      const mockOutcome = {
        targetNewHp: 15,
        damageType: 'piercing',
        hit: true,
        finalDamage: 8,
        isCritical: false,
      };

      // Mock executeAuthoritativeCombatIntent response
      const intentResponse = {
        ok: true,
        json: async () => ({ result: mockOutcome }),
      };
      (globalThis.fetch as any).mockResolvedValue(intentResponse);

      const result = await executeStructuredCombatAction(encounterId, action);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"type":"attack"'),
        })
      );

      expect(result).toEqual([
        {
          participantId: 'target-1',
          newHp: 15,
          damageType: 'piercing',
          hit: true,
          finalDamage: 8,
          isCritical: false,
        },
      ]);
    });

    it('should handle spell actions with multiple targets correctly', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'cast_spell' as const,
        target_ids: ['target-1', 'target-2'],
        weapon_id: null,
        spell_id: 'fireball',
        slot_level: 3,
        movement_feet: 0,
      };

      const mockResults = {
        results: [
          { targetNewHp: 5, damageType: 'fire', hit: true, finalDamage: 24, isCritical: false },
          { targetNewHp: 12, damageType: 'fire', hit: false, finalDamage: 12, isCritical: false },
        ],
      };

      const intentResponse = {
        ok: true,
        json: async () => ({ result: mockResults }),
      };
      (globalThis.fetch as any).mockResolvedValue(intentResponse);

      const result = await executeStructuredCombatAction(encounterId, action);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"type":"spell"'),
        })
      );

      expect(result).toEqual([
        {
          participantId: 'target-1',
          newHp: 5,
          damageType: 'fire',
          hit: true,
          finalDamage: 24,
          isCritical: false,
        },
        {
          participantId: 'target-2',
          newHp: 12,
          damageType: 'fire',
          hit: false,
          finalDamage: 12,
          isCritical: false,
        },
      ]);
    });

    it('should handle dash, dodge, and disengage actions correctly and return empty array', async () => {
      const actions = ['dash', 'dodge', 'disengage'].map((type) => ({
        actor_id: 'actor-1',
        action_type: type as any,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      }));

      for (const action of actions) {
        const intentResponse = {
          ok: true,
          json: async () => ({ result: {} }),
        };
        (globalThis.fetch as any).mockResolvedValue(intentResponse);

        const result = await executeStructuredCombatAction(encounterId, action);
        expect(result).toEqual([]);
      }
    });

    it('should return empty array for unsupported action types', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'use_object' as const,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };

      const result = await executeStructuredCombatAction(encounterId, action);
      expect(result).toEqual([]);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('should map fallback participantId correctly when results outcome is less than target_ids', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'cast_spell' as const,
        target_ids: ['target-1', 'target-2'],
        weapon_id: null,
        spell_id: 'magic-missile',
        slot_level: 1,
        movement_feet: 0,
      };

      // Suppose API returns fewer result objects than target_ids for some reason (or empty array)
      const mockResults = {
        results: [
          { targetNewHp: 10, damageType: 'force', hit: true, finalDamage: 4, isCritical: false },
        ],
      };

      const intentResponse = {
        ok: true,
        json: async () => ({ result: mockResults }),
      };
      (globalThis.fetch as any).mockResolvedValue(intentResponse);

      const result = await executeStructuredCombatAction(encounterId, action);

      expect(result).toEqual([
        {
          participantId: 'target-1',
          newHp: 10,
          damageType: 'force',
          hit: true,
          finalDamage: 4,
          isCritical: false,
        },
      ]);
    });
  });
});
