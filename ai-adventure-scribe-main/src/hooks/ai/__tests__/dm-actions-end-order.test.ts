/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { AIService } from '@/services/ai-service';
import { executeStructuredCombatActionWithBoundary } from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * #2524, run D1: the handler used to call `endTacticalMap` before resolving declared
 * actions; the refresh flipped `isInCombat` false and the resolution step was skipped,
 * so the player's "attack it again" was never rolled. These tests pin the new order —
 * resolve first, evaluate the end last — and the 409 contract (fight not over).
 */
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    resolveAoECast: vi.fn(),
  },
}));

const ACTIVE_ENCOUNTER = { id: 'encounter-1', phase: 'active' };

const DECLARED_ATTACK = {
  actor_id: 'the-veteran',
  action_type: 'attack',
  target_ids: ['vitruvian-spider'],
  weapon_id: 'longsword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const invoke = (result: Record<string, unknown>): Promise<any> =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    characterRecord: { id: 'char-1' },
    activeEncounter: ACTIVE_ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER),
    aiContext: { gameState: { tacticalContext: '' } },
    conversationHistory: [],
    playerMessage: 'attack it again',
    result,
  } as any);

describe('the end transition is evaluated after declared actions resolve (#2524)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: 'narrated resolution' } as any);
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [],
      boundary: null,
    });
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({ ok: true } as any);
  });

  it('resolves the declared attack before calling the end, forwarding combat_exits', async () => {
    // The resolution narration is a fresh DM envelope; it still carries the end.
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The blow lands. The spider reels.',
      combat_transition: 'end',
    } as any);
    await invoke({
      text: 'You bring your longsword down again.',
      roll_requests: [],
      combat_transition: 'end',
      combat_actions: [DECLARED_ATTACK],
      combat_exits: [{ participant_id: 'vitruvian-spider', exit: 'fled' }],
      combatants: [],
      map_actions: [],
      handout_actions: [],
    });

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalled();
    expect(userDataApi.endTacticalMap).toHaveBeenCalledWith('session-1', undefined, [
      { participant_id: 'vitruvian-spider', exit: 'fled' },
    ]);
    const resolveOrder = vi.mocked(executeStructuredCombatActionWithBoundary).mock
      .invocationCallOrder[0];
    const endOrder = vi.mocked(userDataApi.endTacticalMap).mock.invocationCallOrder[0];
    expect(resolveOrder).toBeLessThan(endOrder);
  });

  it('a 409 keeps the turn in combat and tells the player the fight is not over', async () => {
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'combat_end_refused_live_hostiles' }),
    } as any);

    const outcome = await invoke({
      text: 'The path ahead lies open.',
      roll_requests: [],
      combat_transition: 'end',
      combat_actions: [],
      combatants: [],
      map_actions: [],
      handout_actions: [],
    });

    expect(outcome.result.combat_transition).toBe('none');
    expect(outcome.isInCombat).toBe(true);
    const notices = JSON.stringify(outcome.localNotices ?? outcome.localNotice ?? '');
    expect(notices).toContain('fight is not over');
  });

  it('a 500 does not override the transition or claim the fight continues (#2563)', async () => {
    // Only a 409 is a scene-end refusal. Any other failure is a request problem, not
    // evidence about the fight: the envelope's end stands, no notice is shown, and
    // combat state comes from the refresh, not a forced flag.
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'internal' }),
    } as any);

    const outcome = await invoke({
      text: 'The path ahead lies open.',
      roll_requests: [],
      combat_transition: 'end',
      combat_actions: [],
      combatants: [],
      map_actions: [],
      handout_actions: [],
    });

    expect(outcome.result.combat_transition).toBe('end');
    const notices = JSON.stringify(outcome.localNotices ?? outcome.localNotice ?? '');
    expect(notices).not.toContain('fight is not over');
  });
});
