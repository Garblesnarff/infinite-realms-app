/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1315 — P1 client stall at combat start (Hark S1-002, prod 7dc2c384).
 *
 * The DM reply was a valid combat start (combat_transition: start,
 * combat_entry_pending, roll_requests: [initiative]) in 6-7 s, but the client
 * never asked the player to confirm, never called /enter, and its 90 s turn
 * timer fired six times. This test feeds that exact envelope shape through
 * use-ai-response with a character record like the premade (Stone Giant
 * Barbarian, Ketil Barrow) and asserts the confirm prompt is requested and
 * the turn timers are paused while it waits.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { usePendingCombatEntryOffer } from '@/hooks/combat/use-pending-combat-entry-offer';
import { AIService } from '@/services/ai-service';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import {
  clearCombatEntryTurnConfirmed,
  registerCombatEntryPlayerSource,
} from '@/services/combat/combat-entry-delivery';
import { requestPlayerInitiativeRoll } from '@/services/combat/player-roll-bridge';
import { buildCombatEntryPlayer } from '@/services/combat/structured-combat-payload';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(() => ({ state: { character: null } })),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
    getActiveCombat: vi.fn(),
    enterCombat: vi.fn(),
    declinePendingCombatEntry: vi.fn(),
    endTacticalMap: vi.fn().mockResolvedValue({ ok: true }),
    applyDmTacticalActions: vi.fn().mockResolvedValue({ ok: true }),
    applyDmHandoutActions: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    resolveAoECast: vi.fn().mockResolvedValue({ ok: true }),
    setPendingCombatIntent: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
    promotePendingCombatIntent: vi.fn(),
    fetchSessionFallenState: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
  consumeCombatEntryTypedAnswer: vi.fn().mockReturnValue(false),
}));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/hooks/ai/game-phase-updater', () => ({
  updateGamePhase: vi.fn(),
  clampCombatIntentFlags: vi.fn((start, end) => ({
    shouldStartCombat: start,
    shouldEndCombat: end,
  })),
}));
vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn().mockResolvedValue({
    playerRollRequests: [],
    npcRollResults: [],
    npcRollContinuationText: '',
  }),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/infrastructure/api', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  llmApiClient: { generateText: vi.fn().mockResolvedValue('') },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/hooks/ai/combat-resolution-step', () => ({
  resolveDeclaredCombatActions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPlayerAttackRoll: vi.fn(),
  requestPlayerInitiativeRoll: vi.fn(),
  trackPlayerRollDismissal: async (ask: () => Promise<unknown>) => ({
    value: await ask(),
    dismissed: false,
  }),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn().mockResolvedValue({
    movementOnly: false,
    spellId: 'fire-bolt',
    spellName: 'Fire Bolt',
    kind: 'attack',
    attackBonus: 6,
    saveDC: 14,
    targetAc: 13,
    advantage: false,
    disadvantage: false,
  }),
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
// The offer hook polls the authoritative combat read on mount; the socket-frame
// tests drive the frame directly, so the poll must stay quiet, not offer.
vi.mock('@/contexts/combat/use-authoritative-combat-sync', () => ({
  readAuthoritativeCombat: vi.fn(async () => ({ state: 'unknown' })),
}));

/** The premade as the session context holds it: template shape, uppercase ability keys. */
const KETIL = {
  id: 'char-ketil',
  name: 'Ketil Barrow',
  race: 'Stone Giant',
  class: 'Barbarian',
  level: 1,
  ability_scores: { STR: 18, DEX: 12, CON: 16, INT: 8, WIS: 10, CHA: 10 },
  current_hit_points: 14,
  max_hit_points: 14,
};

const SESSION_ID = 'session-1315';

const PENDING_ENTRY = {
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

/** The prod envelope shape: valid combat start, initiative roll, 4 participants. */
const COMBAT_START_ENVELOPE = {
  text: 'The Gilded Sailors turn on you, blades out.',
  combat_transition: 'start',
  combat_entry_pending: PENDING_ENTRY,
  roll_requests: [{ type: 'initiative', formula: '1d20+1', purpose: 'Initiative' }],
  combat_actions: [],
  map_actions: [],
  handout_actions: [],
};

const MESSAGES = [
  { text: 'You enter the low dark.', sender: 'dm', timestamp: new Date().toISOString() },
  { text: 'I press on.', sender: 'player', timestamp: new Date().toISOString() },
  { text: 'The sailors watch you.', sender: 'dm', timestamp: new Date().toISOString() },
  {
    text: 'Turn and Face the Gilded Sailors',
    sender: 'player',
    timestamp: new Date().toISOString(),
  },
];

describe('useAIResponse: combat-start envelope reaches the confirm prompt (#1315)', () => {
  let chooseConfirm: (confirmed: boolean) => void;
  let chooseInitiative: (roll: { d20: number | null }) => void;
  let onPlayerWaitChange: ReturnType<typeof vi.fn>;

  const play = (character: unknown, sessionId: string = SESSION_ID): Promise<any> => {
    vi.mocked(useCharacter).mockReturnValue({ state: { character } } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: sessionId,
      campaign_id: 'camp-1',
      character_id: (character as { id?: string } | null)?.id ?? 'char-ketil',
      campaign: { id: 'camp-1' },
      character,
    } as any);
    const { result } = renderHook(() => useAIResponse());
    const abort = new AbortController();
    (abort.signal as any).onPlayerWaitChange = onPlayerWaitChange;
    return result.current.getAIResponse(
      MESSAGES as any,
      sessionId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      abort.signal,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as any);
    vi.mocked(userDataApi.getActiveCombat).mockResolvedValue({ ok: false } as any);
    vi.mocked(userDataApi.enterCombat).mockResolvedValue({
      ok: true,
      json: async () => ({ encounter: { id: 'enc-1' }, participants: [] }),
    } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue(COMBAT_START_ENVELOPE as any);
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          chooseConfirm = (confirmed) => resolve(confirmed);
        }),
    );
    vi.mocked(requestPlayerInitiativeRoll).mockImplementation(
      () =>
        new Promise<{ d20: number | null }>((resolve) => {
          chooseInitiative = (roll) => resolve(roll);
        }),
    );
    onPlayerWaitChange = vi.fn();
  });

  it('premade record: confirm is requested and turn timers pause while it waits', async () => {
    const turn = play(KETIL);
    await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));
    // The wait pauses the 90 s turn timer: without this the timer fires mid-prompt.
    expect(onPlayerWaitChange).toHaveBeenCalledWith(true);
    const spec = vi.mocked(requestCombatEntryConfirmation).mock.calls[0][0];
    expect(spec.actorLabel).toBe('Ketil Barrow');

    chooseConfirm(true);
    await vi.waitFor(() => expect(requestPlayerInitiativeRoll).toHaveBeenCalledTimes(1));
    chooseInitiative({ d20: 12 });
    await turn;

    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(userDataApi.enterCombat).mock.calls[0];
    expect((body as any).player.name).toBe('Ketil Barrow');
    expect((body as any).playerInitiativeRoll).toBe(12);
  });

  it('socket frame before the reply: timers pause through the joined delivery', async () => {
    // Round 2, Required 1: the server broadcasts the pending entry over the
    // socket BEFORE the HTTP reply returns (the S1-002 shape: the frame
    // arrives before the generate call). The offer starts a delivery
    // with no confirm closure and no pause; the generate handler then joins
    // that in-flight promise. The timers must stay paused through the join
    // and the confirm must be requested. On main (no outer wrap around the
    // join) the join's pause never fires, so this test FAILS on main.
    const sessionId = 'session-1315-frame-before';
    const unregister = registerCombatEntryPlayerSource(() =>
      buildCombatEntryPlayer(KETIL as Record<string, unknown>),
    );
    const { unmount: unmountOffer } = renderHook(() => usePendingCombatEntryOffer(sessionId));
    try {
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('combat-state-updated', {
            detail: { type: 'combat_state_updated', combatEntryPending: PENDING_ENTRY },
          }),
        );
      });
      // The offer's delivery is in flight, waiting on the confirm bridge.
      await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));

      const turn = play(KETIL, sessionId);
      // The join itself must HOLD the pause while parked on the confirm
      // bridge. The pre-handler waits (held save, held entry) in this turn
      // balance to false, so a last call of true here can only come from the
      // join's outer wrap — on main (no wrap) the last call stays false and
      // this assertion fails.
      await vi.waitFor(() => {
        const calls = onPlayerWaitChange.mock.calls;
        expect(calls[calls.length - 1]).toEqual([true]);
      });

      chooseConfirm(true);
      await vi.waitFor(() => expect(requestPlayerInitiativeRoll).toHaveBeenCalledTimes(1));
      chooseInitiative({ d20: 12 });
      await turn;

      expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
      const [, body] = vi.mocked(userDataApi.enterCombat).mock.calls[0];
      expect((body as any).player.name).toBe('Ketil Barrow');
      expect((body as any).playerInitiativeRoll).toBe(12);
    } finally {
      unmountOffer();
      unregister();
      clearCombatEntryTurnConfirmed(sessionId);
    }
  });

  it('socket frame after the handler call: pause holds, offer joins silently', async () => {
    // Round 2, Hark S1-003 note: cover the frame arriving AFTER the handler's
    // call as well. The handler starts its own delivery (its confirm closure
    // pauses the timers); the offer then joins that in-flight promise, which
    // must not open a second card or drop the pause. This ordering passes on
    // main too — the pause comes from the handler's own closure, not the
    // outer wrap — which narrows S1-002's second condition away from frame
    // ordering and toward the offer card never rendering.
    const sessionId = 'session-1315-frame-after';
    const unregister = registerCombatEntryPlayerSource(() =>
      buildCombatEntryPlayer(KETIL as Record<string, unknown>),
    );
    const { unmount: unmountOffer } = renderHook(() => usePendingCombatEntryOffer(sessionId));
    try {
      const turn = play(KETIL, sessionId);
      await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(onPlayerWaitChange).toHaveBeenCalledWith(true));

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent('combat-state-updated', {
            detail: { type: 'combat_state_updated', combatEntryPending: PENDING_ENTRY },
          }),
        );
      });
      // Still paused, still exactly one confirm: the offer joined, not re-asked.
      // The pause here is held by the handler's own wrapped confirm closure,
      // so this holds on main too (see the test comment above).
      await vi.waitFor(() => {
        const calls = onPlayerWaitChange.mock.calls;
        expect(calls[calls.length - 1]).toEqual([true]);
      });
      expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1);

      chooseConfirm(true);
      await vi.waitFor(() => expect(requestPlayerInitiativeRoll).toHaveBeenCalledTimes(1));
      chooseInitiative({ d20: 12 });
      await turn;

      expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    } finally {
      unmountOffer();
      unregister();
      clearCombatEntryTurnConfirmed(sessionId);
    }
  });
});
