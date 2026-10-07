/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  ACTION_MISSING_DESTINATION_REASON,
  ACTION_MISSING_TARGET_REASON,
  ACTION_NOT_SUPPORTED_REASON,
  CombatIntentRefusedError,
  HIDE_CHECK_UNROUTABLE_REASON,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatAction,
  executeStructuredCombatActionWithBoundary,
} from '../combat-action-executor';

const { mockReportClientFailure, mockToast } = vi.hoisted(() => ({
  mockReportClientFailure: vi.fn(),
  mockToast: vi.fn(),
}));

// Mock getAuthHeaders
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mockReportClientFailure },
}));

vi.mock('@/hooks/use-toast', () => ({ toast: mockToast }));

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
        }),
      );
      expect(result).toBe('dash-success');
    });

    it('should fetch the combat status first if a player intent has no expectedVersion', async () => {
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

      const result = await executeAuthoritativeCombatIntent(encounterId, intent, 'player');

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8888/v1/combat/encounter-123/status',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
        }),
      );
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            intent: { ...intent, expectedVersion: 10 },
            source: 'player',
            dmStartedAt: undefined,
          }),
        }),
      );
      expect(result).toBe('dash-success-fetched-version');
    });

    // The old guard was `'expectedVersion' in intent`, which is false for every object literal
    // that simply omits the field — so no caller ever triggered the status read. Both hooks
    // that build player attacks construct exactly this shape.
    it('should fetch the version for a player attack built without the key at all', async () => {
      const intent = { type: 'attack' as const, actorId: 'actor-1', targetId: 'target-1' };
      (globalThis.fetch as any)
        .mockResolvedValueOnce({ ok: true, json: async () => ({ encounter: { version: 4 } }) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'hit' }) });

      await executeAuthoritativeCombatIntent(encounterId, intent);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(globalThis.fetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"expectedVersion":4'),
        }),
      );
    });

    // The server dispatch is the authoritative sequencer for DM-sourced intents: it reads the
    // encounter version itself, so the client must not spend a round trip guessing one.
    it('should not read the version for a DM-sourced intent', async () => {
      const intent = { type: 'attack' as const, actorId: 'the-void-maw', targetId: 'the-seeker' };
      (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ result: {} }) });

      await executeAuthoritativeCombatIntent(encounterId, intent, 'dm', 12345);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: JSON.stringify({ intent, source: 'dm', dmStartedAt: 12345 }),
        }),
      );
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
        }),
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
        'Combat state unavailable (404)',
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
        'Invalid actor state',
      );

      expect(mockReportClientFailure).toHaveBeenCalledWith(
        'combat_intent_failed',
        undefined,
        'encounter=encounter-123; Invalid actor state',
      );
      expect(mockToast).toHaveBeenCalledWith({
        title: 'Combat action failed',
        description: 'The server could not complete that action. Please try again.',
        variant: 'destructive',
      });
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
        'Combat action rejected (500)',
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
        }),
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
        }),
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

    it('sends the player attack-popup d20 on a spell intent', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'cast_spell' as const,
        target_ids: ['target-1'],
        weapon_id: null,
        spell_id: 'fire-bolt',
        slot_level: null,
        movement_feet: 0,
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { results: [] } }),
      });

      await executeStructuredCombatAction(encounterId, action, 17);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.intent).toEqual(
        expect.objectContaining({
          type: 'spell',
          spellId: 'fire-bolt',
          d20: 17,
        }),
      );
    });

    it('omits d20 on a save-spell payload when the player did not throw one', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'cast_spell' as const,
        target_ids: ['target-1'],
        weapon_id: null,
        spell_id: 'acid-splash',
        slot_level: null,
        movement_feet: 0,
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { results: [] } }),
      });

      await executeStructuredCombatAction(encounterId, action);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.intent.type).toBe('spell');
      expect(body.intent).not.toHaveProperty('d20');
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

    it('should execute a server-authoritative move action with its planned destination', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'move' as const,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 30,
        x: 7,
        y: 0,
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { success: true, remainingFeet: 0 } }),
      });

      await expect(executeStructuredCombatAction(encounterId, action)).resolves.toEqual([]);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"type":"move"'),
        }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"x":7'),
        }),
      );
    });

    // This test used to assert `[]` and no fetch for `use_object` — it codified the bug:
    // the empty success settled the declaration as if acted, so the turn ended and NPC
    // turns advanced on an action the engine never ran. The executor has no engine owner
    // for these three types, so it refuses them; `hide` is not among them (contested
    // checks own it, #2420).
    it('refuses declared action types the engine has no owner for', async () => {
      for (const actionType of ['help', 'ready', 'use_object'] as const) {
        const action = {
          actor_id: 'actor-1',
          action_type: actionType,
          target_ids: [],
          weapon_id: null,
          spell_id: null,
          slot_level: null,
          movement_feet: 0,
        };

        const refusal = await executeStructuredCombatActionWithBoundary(encounterId, action).catch(
          (error: unknown) => error,
        );

        expect(refusal).toBeInstanceOf(CombatIntentRefusedError);
        expect((refusal as CombatIntentRefusedError).message).toBe(
          'That action is not supported yet',
        );
        expect((refusal as CombatIntentRefusedError).details?.reason).toBe(
          ACTION_NOT_SUPPORTED_REASON,
        );
        expect((refusal as CombatIntentRefusedError).details?.intentType).toBe(actionType);
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    // #2606: a declaration the engine cannot execute as-is must refuse, not settle. An
    // attack with no target and a move with no destination used to fall through to the
    // catch-all empty success, which the resolution step settled like an executed action:
    // the turn ended and NPC turns advanced on an action that never ran.
    it('refuses a declared attack that named no target', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'attack' as const,
        target_ids: [],
        weapon_id: 'weapon-longbow',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };

      const refusal = await executeStructuredCombatActionWithBoundary(encounterId, action).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(CombatIntentRefusedError);
      expect((refusal as CombatIntentRefusedError).message).toBe(
        'No target named — pick a target or type who you attack.',
      );
      expect((refusal as CombatIntentRefusedError).details?.reason).toBe(
        ACTION_MISSING_TARGET_REASON,
      );
      expect((refusal as CombatIntentRefusedError).details?.intentType).toBe('attack');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('refuses a declared move with no destination square', async () => {
      // x/y are optional on the DM's declaration: absent (or only one present) means the
      // DM named no square.
      for (const coords of [{}, { x: 7 }, { y: 0 }] as const) {
        const action = {
          actor_id: 'actor-1',
          action_type: 'move' as const,
          target_ids: [],
          weapon_id: null,
          spell_id: null,
          slot_level: null,
          movement_feet: 30,
          ...coords,
        };

        const refusal = await executeStructuredCombatActionWithBoundary(encounterId, action).catch(
          (error: unknown) => error,
        );

        expect(refusal).toBeInstanceOf(CombatIntentRefusedError);
        expect((refusal as CombatIntentRefusedError).message).toBe(
          'No destination — pick a square on the map.',
        );
        expect((refusal as CombatIntentRefusedError).details?.reason).toBe(
          ACTION_MISSING_DESTINATION_REASON,
        );
        expect((refusal as CombatIntentRefusedError).details?.intentType).toBe('move');
      }
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('routes a DM-declared hide to the check intent with checkKind hide', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'hide' as const,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({ result: { resolvedAs: 'check', success: true } }),
      });

      await executeStructuredCombatActionWithBoundary(encounterId, action);

      // The same check intent the player-initiated Hide posts (#2603): DM-sourced, so no
      // version read — exactly one POST, straight to the intent route.
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"type":"check"'),
        }),
      );
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8888/v1/combat/encounter-123/intent',
        expect.objectContaining({
          body: expect.stringContaining('"checkKind":"hide"'),
        }),
      );
    });

    it('refuses a hide the engine will not route instead of settling it', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'hide' as const,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };
      (globalThis.fetch as any).mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({ error: 'nothing to hide behind', details: { reason: 'no_cover' } }),
      });

      const refusal = await executeStructuredCombatActionWithBoundary(encounterId, action).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(CombatIntentRefusedError);
      // The engine's reason is not actionable here: the player is pointed at the Hide
      // option that owns the die and the popup.
      expect((refusal as CombatIntentRefusedError).message).toBe(
        'Hide needs a Stealth check — use the Hide option.',
      );
      expect((refusal as CombatIntentRefusedError).details?.reason).toBe(
        HIDE_CHECK_UNROUTABLE_REASON,
      );
      expect((refusal as CombatIntentRefusedError).details?.intentType).toBe('hide');
    });

    it('does not translate a non-refusal failure on the hide check route', async () => {
      const action = {
        actor_id: 'actor-1',
        action_type: 'hide' as const,
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };
      (globalThis.fetch as any).mockRejectedValue(new TypeError('network down'));

      await expect(
        executeStructuredCombatActionWithBoundary(encounterId, action),
      ).rejects.toThrow('network down');
    });

    it('refuses an action_type outside the union instead of settling it', async () => {
      // Declared actions arrive as parsed DM JSON: a typo or hallucinated verb reaches
      // the catch-all at runtime. It used to return the empty success, which the
      // resolution step settled like an executed action.
      const action = {
        actor_id: 'actor-1',
        action_type: 'sneak' as unknown as 'attack',
        target_ids: [],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      };

      const refusal = await executeStructuredCombatActionWithBoundary(encounterId, action).catch(
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(CombatIntentRefusedError);
      expect((refusal as CombatIntentRefusedError).message).toBe(
        'That action is not supported yet',
      );
      expect((refusal as CombatIntentRefusedError).details?.reason).toBe(
        ACTION_NOT_SUPPORTED_REASON,
      );
      expect((refusal as CombatIntentRefusedError).details?.intentType).toBe('sneak');
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
