/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

import {
  hasPendingPlayerRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
  type PlayerRollHost,
  type PlayerRollOutcome,
} from '@/services/combat/player-roll-bridge';

/**
 * #2234, run M4 turn 8: an "Unarmed Strike attack … 1d20+1 vs AC 14" prompt the player never
 * declared. They clicked Dismiss, and the engine resolved it anyway:
 * "The Apprentice rolled 7 + 1 = 8 vs AC 14 … with Unarmed Strike — MISS".
 *
 * The real attack-die helper and the real bridge run here; only the engine calls are stubbed.
 * A dismissed prompt must reach the engine as nothing at all.
 */

const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const proposeAuthoritativeAttack = vi.fn();
/** Observes the narration gate so the terminal short-circuit test can assert it never ran. */
const enforceNarrationGate = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({ repairRefusedCombatAction: vi.fn() }));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeAttack: (...args: any[]) => proposeAuthoritativeAttack(...args),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../narration-gate', () => ({
  enforceNarrationGate: (...args: any[]) => enforceNarrationGate(...args),
  gateInventedExtraStrike: async ({ narration }: any) => narration,
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

/** The End turn intents this layer sent: the one request behind which the server runs NPC turns. */
const endTurnIntents = () =>
  executeAuthoritativeCombatIntent.mock.calls.filter(
    ([, intent]: any[]) => intent?.type === 'end_turn',
  );

const PLAYER_ID = 'the-apprentice-1';
const NPC_ID = 'flavor-elemental-1';
const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'The Apprentice', participantType: 'player' },
  { id: NPC_ID, name: 'Flavor-Elemental (Corrupted)', participantType: 'monster' },
];
const UNARMED_STRIKE = {
  actor_id: PLAYER_ID,
  action_type: 'attack',
  target_ids: [NPC_ID],
  weapon_id: 'unarmed-strike',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/** A dice popup that answers the way the player did. */
function hostThatAnswers(outcome: PlayerRollOutcome): PlayerRollHost {
  return {
    present: (_spec, settle) => {
      queueMicrotask(() => settle(outcome));
      return { rollId: 'roll-1', dismiss: vi.fn() };
    },
  };
}

const resolve = (overrides: Record<string, unknown> = {}) =>
  resolveDeclaredCombatActions({
    encounterId: 'encounter-1',
    sessionId: 'session-1',
    combatActions: [UNARMED_STRIKE],
    declarationText: 'Your fist cracks against the elemental!',
    aiContext: { gameState: {} },
    conversationHistory: [],
    participants: PARTICIPANTS,
    combatRound: 2,
    ...overrides,
  });

describe('a dismissed engine attack prompt (#2234)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proposeAuthoritativeAttack.mockResolvedValue({
      legal: true,
      weaponName: 'Unarmed Strike',
      targetLabel: 'Flavor-Elemental (Corrupted)',
      attackBonus: 1,
      targetAc: 14,
    });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      boundary: null,
      outcomes: [],
      result: { hit: false },
    });
    // The End turn body: the boundary, plus the creature the server ran before answering
    // (`npcTurns`, the drain's AdvanceNpcTurnsResult shape) — #2658 step 3.
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: NPC_ID },
      engineRows: [],
      npcTurns: {
        results: [],
        currentParticipant: { id: PLAYER_ID, name: 'The Apprentice', participantType: 'player' },
        round: 1,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      },
    });
    chatWithDM.mockResolvedValue({ text: 'The elemental reels.' });
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  it('resolves no attack, ends no turn, and narrates nothing when the player dismisses', async () => {
    setPlayerRollHost(hostThatAnswers({ d20: null, cancelled: true }));

    const result = await resolve();

    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(endTurnIntents()).toEqual([]);
    expect(chatWithDM).not.toHaveBeenCalled();
    expect(result.text).toBe(
      'You dismissed the roll, so that attack did not happen. It is still your turn — what do you do?',
    );
    expect(result.text).not.toMatch(/rolled|MISS|HIT/);
  });

  it('still lets the engine roll when the prompt times out rather than being dismissed', async () => {
    setPlayerRollHost(hostThatAnswers({ d20: null }));

    await resolve();

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      UNARMED_STRIKE,
      undefined,
      undefined,
    );
  });

  it("uses the player's own die when they roll", async () => {
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));

    await resolve();

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      UNARMED_STRIKE,
      15,
      undefined,
    );
  });

  it("carries the popup's dropped die into the commit (#263 CB-028)", async () => {
    setPlayerRollHost(hostThatAnswers({ d20: 8, d20Rolls: [8, 14] }));

    await resolve();

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      UNARMED_STRIKE,
      8,
      [8, 14],
    );
  });

  it('marks the attack popup as a player wait', async () => {
    const waits: boolean[] = [];
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));

    await resolve({ onPlayerWaitChange: (waiting: boolean) => waits.push(waiting) });

    expect(waits).toEqual([true, false]);
  });

  // Renamed (#2658 step 3): was "aborting after the action stops end_turn and the NPC advance"
  it('aborting after the action sends no end_turn, so the server runs no NPC turn', async () => {
    const controller = new AbortController();
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));
    executeStructuredCombatActionWithBoundary.mockImplementationOnce(async () => {
      controller.abort();
      return {
        boundary: null,
        outcomes: [],
        result: { hit: true },
      };
    });

    await expect(resolve({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(endTurnIntents()).toEqual([]);
  });

  it('withdraws an entry action whose prompt was dismissed upstream', async () => {
    const present = vi.fn();
    setPlayerRollHost({ present });

    const result = await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [UNARMED_STRIKE],
      declarationText: 'Combat entry was confirmed.',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      playerAttackRoll: { action: UNARMED_STRIKE as any, autoRolled: false, cancelled: true },
    });

    expect(present).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(result.text).toMatch(/^You dismissed the roll/);
  });

  it('leaves no pending player roll after a save cantrip resolves (Acid Splash)', async () => {
    const present = vi.fn();
    setPlayerRollHost({ present });

    await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [
        { ...UNARMED_STRIKE, action_type: 'cast_spell', weapon_id: null, spell_id: 'acid-splash' },
      ],
      declarationText: 'Acid arcs toward the elemental.',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
    });

    // A save spell has no player die: no popup was opened and nothing waits on one.
    expect(present).not.toHaveBeenCalled();
    expect(hasPendingPlayerRoll()).toBe(false);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
  });

  it('a party_defeated narration short-circuits before the narration gate (#261 CB-027)', async () => {
    // A silent player turn with nothing resolved: no engine lines, so without the
    // short-circuit the narration gate would run on this envelope (narrationGated is
    // true here) and rewrite the empty-text terminal envelope into a "Processing Error".
    enforceNarrationGate.mockResolvedValueOnce({ narration: { text: 'Processing Error' } });
    chatWithDM.mockResolvedValue({ text: '', terminalState: 'party_defeated' });

    const result = await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [],
      declarationText: '',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 2,
      silentPlayerTurn: { playerMessage: 'You hold your ground.' },
    });

    // The terminal flag comes straight from the resolution's narrate(): the gate that
    // would rewrite the empty-text envelope into a "Processing Error" never runs.
    expect(result.terminalState).toBe('party_defeated');
    expect(enforceNarrationGate).not.toHaveBeenCalled();
  });
});

describe('death-save 45 s timer engine line (#261)', () => {
  const DEATH_SAVE = {
    actor_id: PLAYER_ID,
    action_type: 'death_save',
    target_ids: [],
    weapon_id: null,
    spell_id: null,
    slot_level: null,
    movement_feet: 0,
  };
  // The engine's save result: one successful save. The real producer is the combat
  // endpoint's death-save settlement; the shape here is what formatDeathSaveParts reads
  // (result.deathSaves).
  const SAVE_RESULT = {
    boundary: null,
    outcomes: [],
    result: {
      deathSaves: [
        {
          participantId: PLAYER_ID,
          roll: 14,
          isSuccess: true,
          isCritical: false,
          successes: 1,
          failures: 0,
        },
      ],
    },
  };

  const resolveDeathSave = (
    overrides: Record<string, unknown> = {},
  ): Promise<{ combatEngineBlocks?: Array<{ lines?: string[] }> }> =>
    resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [DEATH_SAVE],
      declarationText: 'The Apprentice fights to stay alive.',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 2,
      ...overrides,
    });

  const flatLines = (result: { combatEngineBlocks?: Array<{ lines?: string[] }> }): string[] =>
    (result.combatEngineBlocks ?? []).flatMap((block) => block.lines ?? []);

  beforeEach(() => {
    executeStructuredCombatActionWithBoundary.mockResolvedValue(SAVE_RESULT);
  });

  it('prints "Death save auto-rolled after 45 s." ahead of the save lines when the timer fires', async () => {
    setPlayerRollHost(hostThatAnswers({ d20: null, timedOut: true }));

    const result = await resolveDeathSave();
    const lines = flatLines(result);

    const autoIdx = lines.findIndex((line) => line.includes('Death save auto-rolled after 45 s.'));
    const saveIdx = lines.findIndex((line) => line.includes('death saving throw'));
    expect(autoIdx).toBeGreaterThanOrEqual(0);
    expect(saveIdx).toBeGreaterThanOrEqual(0);
    expect(autoIdx).toBeLessThan(saveIdx);
  });

  it('prints no auto-rolled line when the player rolls their own die', async () => {
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));

    const result = await resolveDeathSave();
    const lines = flatLines(result);

    expect(lines.some((line) => line.includes('Death save auto-rolled after 45 s.'))).toBe(false);
    expect(lines.some((line) => line.includes('death saving throw'))).toBe(true);
  });
});
