/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1315 — the generate handler joins an in-flight poll delivery without
 * pausing the turn timers.
 *
 * The 5 s pending-entry poll can offer the stored entry before the generate
 * response returns. The handler then joins that delivery through the shared
 * in-flight promise instead of calling its own confirm closure, so its
 * awaitPlayerInput (and the timer pause) never runs: the 90 s turn timer
 * fires mid-prompt, the abort settles the card as declined, and the turn
 * fails with a timeout — six times in a row on prod.
 *
 * This test starts a poll-style delivery first (no confirm closure, prompt
 * pending), then runs the handler for the same entry, and asserts the turn
 * timers are paused while the handler waits on the joined delivery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import logger from '@/lib/logger';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import { startCombatEntryDelivery } from '@/services/combat/combat-entry-delivery';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPlayerAttackRoll: vi.fn(),
  requestPlayerInitiativeRoll: vi.fn().mockResolvedValue({ d20: 12 }),
  trackPlayerRollDismissal: async (ask: () => Promise<unknown>) => ({
    value: await ask(),
    dismissed: false,
  }),
}));
vi.mock('@/hooks/ai/combat-resolution-step', () => ({
  resolveDeclaredCombatActions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn().mockResolvedValue({ movementOnly: false }),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
  combatBoundaryFromResult: vi.fn(),
}));
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn().mockResolvedValue({ ok: true }),
    applyDmTacticalActions: vi.fn().mockResolvedValue({ ok: true }),
    applyDmHandoutActions: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    resolveAoECast: vi.fn().mockResolvedValue({ ok: true }),
    enterCombat: vi.fn(),
    getActiveCombat: vi.fn(),
    setPendingCombatIntent: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
    promotePendingCombatIntent: vi.fn(),
    declinePendingCombatEntry: vi.fn(),
  },
}));

const PLAYER = {
  id: 'char-ketil',
  name: 'Ketil Barrow',
  race: 'Stone Giant',
  class: 'Barbarian',
};

const PENDING = {
  trigger: 'tactical_action' as const,
  detail: 'The Gilded Sailors turn hostile',
  combatants: [
    { name: 'Gilded Sailor 1', count: 1 },
    { name: 'Gilded Sailor 2', count: 1 },
    { name: 'Gilded Sailor 3', count: 1 },
  ],
  sceneSpec: { environment: 'ship_deck' },
  sceneSpecSynthesized: true,
};

describe('handler joins an in-flight poll delivery (#1315)', () => {
  let choosePoll: (confirmed: boolean) => void;
  let onPlayerWaitChange: ReturnType<typeof vi.fn>;

  const baseParams = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    sessionId: 'session-1315',
    result: {
      text: 'The Gilded Sailors turn on you, blades out.',
      combat_transition: 'start',
      combat_entry_pending: PENDING,
      roll_requests: [{ type: 'initiative', formula: '1d20+1', purpose: 'Initiative' }],
      combat_actions: [],
      map_actions: [],
      handout_actions: [],
    },
    characterRecord: PLAYER,
    checkSheet: null,
    activeEncounter: null,
    isInCombat: false,
    refreshCombatState: vi.fn(async () => null),
    aiContext: { gameState: {} },
    conversationHistory: [],
    userPlan: undefined,
    turnCount: 0,
    playerMessage: 'Turn and Face the Gilded Sailors',
    isDiceRollMessage: false,
    playerInputOrigin: 'typed',
    combatRound: undefined,
    entryConfirmed: false,
    onEngineNotice: vi.fn(),
    signal: new AbortController().signal,
    onPlayerWaitChange,
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    onPlayerWaitChange = vi.fn();
    vi.mocked(userDataApi.getActiveCombat).mockResolvedValue({ ok: false } as any);
    vi.mocked(userDataApi.enterCombat).mockResolvedValue({
      ok: true,
      json: async () => ({ encounter: { id: 'enc-1' }, participants: [] }),
    } as any);
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          choosePoll = (confirmed) => resolve(confirmed);
        }),
    );
  });

  it('pauses the turn timers while waiting on the joined delivery', async () => {
    // The poll offers first: no confirm closure, prompt pending.
    const pollDelivery = startCombatEntryDelivery({
      sessionId: 'session-1315',
      pending: PENDING,
      player: { characterId: 'char-ketil', name: 'Ketil Barrow', initiativeModifier: 1 },
    });
    await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));
    expect(onPlayerWaitChange).not.toHaveBeenCalled();

    // The generate handler arrives for the same entry and joins the poll delivery.
    const handlerDone = handleDmActionsAndTransitions(baseParams() as any);

    // The handler waits on the player's answer: the timers must pause, or the
    // 90 s timeout fires mid-prompt and the abort declines the entry.
    await vi.waitFor(() => expect(onPlayerWaitChange).toHaveBeenCalledWith(true));
    expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1);

    choosePoll(true);
    await handlerDone;
    await pollDelivery;
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('pending entry has no usable player payload'),
      expect.anything(),
    );
  });

  it('names a skipped entry: stale active encounter', async () => {
    const out = await handleDmActionsAndTransitions(
      baseParams({
        sessionId: 'session-1315-skip',
        activeEncounter: {
          id: 'enc-stale',
          phase: 'active',
          currentTurnParticipantId: 'p-1',
          currentRound: 1,
          participants: [
            {
              id: 'p-1',
              characterId: 'char-ketil',
              name: 'Ketil Barrow',
              participantType: 'player',
              isActive: true,
              currentHitPoints: 14,
              isUnconscious: false,
            },
          ],
        },
        isInCombat: true,
      }) as any,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('entry_skipped_active_encounter'),
    );
    expect(userDataApi.enterCombat).not.toHaveBeenCalled();
    expect(out.result.combat_entry_pending).toBeDefined();
  });

  it('names a skipped entry: no usable player payload', async () => {
    const out = await handleDmActionsAndTransitions(
      baseParams({ sessionId: 'session-1315-noplayer', characterRecord: { id: 'char-x' } }) as any,
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('entry_no_player'));
    expect(out.result.roll_requests).toEqual([]);
    expect(userDataApi.enterCombat).not.toHaveBeenCalled();
  });

  it('names a declined entry', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);
    await handleDmActionsAndTransitions(baseParams({ sessionId: 'session-1315-decline' }) as any);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('entry_declined'));
    expect(userDataApi.declinePendingCombatEntry).toHaveBeenCalledWith('session-1315-decline');
    expect(userDataApi.enterCombat).not.toHaveBeenCalled();
  });
});
