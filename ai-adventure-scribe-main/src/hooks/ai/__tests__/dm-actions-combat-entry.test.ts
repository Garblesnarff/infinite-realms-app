/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1779 — the client no longer decides combat entry.
 *
 * `dm-actions-handler.ts:64` used to BE the entry gate: `combat_transition === 'start' &&
 * scene_spec`, evaluated in the browser, with nothing behind it. Prod session 5ebaffab put
 * four consecutive hostile actions through that predicate and never entered combat once.
 * These tests pin the new contract: the handler starts nothing and reacts to what the server's
 * turn-pipeline gate already did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { startStructuredCombatTransition } from '@/services/combat/structured-combat-transition';

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
  combatBoundaryFromResult: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn().mockResolvedValue({ ok: true }),
    applyDmTacticalActions: vi.fn().mockResolvedValue({ ok: true }),
    applyDmHandoutActions: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    resolveAoECast: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock('@/services/combat/structured-combat-transition', () => ({
  startStructuredCombatTransition: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/services/combat/combat-zero-action-guard', () => ({
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));

const ACTIVE_ENCOUNTER = {
  id: 'encounter-1',
  phase: 'active',
  currentTurnParticipantId: 'participant-0',
  currentRound: 1,
  participants: [],
};

const invoke = (result: Record<string, unknown>, refresh = vi.fn().mockResolvedValue(null)) =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    result: { text: 'You swing.', ...result },
    characterRecord: { id: 'char-1' },
    activeEncounter: null,
    isInCombat: false,
    refreshCombatState: refresh,
    aiContext: { gameState: {} },
    conversationHistory: [],
  } as any);

describe('handleDmActionsAndTransitions — combat entry (#1779)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('never issues a combat start, even on the exact envelope that used to trigger one', async () => {
    await invoke({ combat_transition: 'start', scene_spec: { environment: 'tavern' } });
    expect(startStructuredCombatTransition).not.toHaveBeenCalled();
  });

  it('does not refresh or activate combat for a pending entry handoff', async () => {
    const refresh = vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          trigger: 'tactical_action',
          detail: 'combat_action attack',
          combatants: [{ name: 'Geometrist', count: 1 }],
          sceneSpec: { environment: 'dungeon_room' },
          sceneSpecSynthesized: true,
        },
      },
      refresh,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(outcome.isInCombat).toBe(false);
    expect(outcome.activeEncounter).toBeNull();
  });

  it('re-reads authoritative state when the server reports it seated an encounter', async () => {
    const refresh = vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'start',
        scene_spec: { environment: 'dungeon_room' },
        combat_entry: {
          entered: true,
          encounterId: 'encounter-1',
          trigger: 'attack_roll_request',
          detail: 'roll_request attack: Punch Dishwasher Prime',
          sceneSpecSynthesized: true,
        },
      },
      refresh,
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(outcome.isInCombat).toBe(true);
    expect(outcome.activeEncounter).toEqual(ACTIVE_ENCOUNTER);
  });

  it('refreshes on a gated entry even if the envelope rewrite were absent', async () => {
    const refresh = vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER);
    await invoke(
      {
        combat_transition: 'none',
        combat_entry: {
          entered: true,
          encounterId: 'encounter-1',
          trigger: 'tactical_action',
          detail: 'map_action forced_move -> dishwasher-prime',
          sceneSpecSynthesized: true,
        },
      },
      refresh,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves a peaceful turn alone', async () => {
    const refresh = vi.fn().mockResolvedValue(null);
    const outcome = await invoke({ combat_transition: 'none' }, refresh);
    expect(refresh).not.toHaveBeenCalled();
    expect(startStructuredCombatTransition).not.toHaveBeenCalled();
    expect(outcome.isInCombat).toBe(false);
  });
});
