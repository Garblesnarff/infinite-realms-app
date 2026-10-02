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
const advanceNpcTurns = vi.fn();

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
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args) },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

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
    executeAuthoritativeCombatIntent.mockResolvedValue({ currentParticipant: { id: NPC_ID } });
    advanceNpcTurns.mockResolvedValue({ results: [], transcriptLines: [] });
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
    expect(advanceNpcTurns).not.toHaveBeenCalled();
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
    );
  });

  it("uses the player's own die when they roll", async () => {
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));

    await resolve();

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      UNARMED_STRIKE,
      15,
    );
  });

  it('marks the attack popup as a player wait', async () => {
    const waits: boolean[] = [];
    setPlayerRollHost(hostThatAnswers({ d20: 15 }));

    await resolve({ onPlayerWaitChange: (waiting: boolean) => waits.push(waiting) });

    expect(waits).toEqual([true, false]);
  });

  it('aborting after the action stops end_turn and the NPC advance', async () => {
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
    expect(advanceNpcTurns).not.toHaveBeenCalled();
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
});
