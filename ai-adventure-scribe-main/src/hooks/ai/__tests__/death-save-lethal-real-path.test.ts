/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

/**
 * #2457: Real-path test for death save engine lines.
 *
 * Drives `resolveDeclaredCombatActions` (the real client path) with an `end_turn`
 * whose server result contains a lethal third-failure death save plus the
 * combat-ended marker. Asserts:
 * - The DEAD line appears in the engine blocks with the "⚙️ Engine:" prefix
 * - The DEAD card is present
 * - No "Narrate" or "already happened" text appears anywhere in the payload
 *   (lines, covers, engineResult)
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const advanceNpcTurns = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: (...args: any[]) => repairRefusedCombatAction(...args),
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const PLAYER_ID = 'player-123';
const MONSTER_ID = 'monster-456';
const PLAYER = { id: PLAYER_ID, name: 'The Hero', participantType: 'player' };
const MONSTER = { id: MONSTER_ID, name: 'Goblin', participantType: 'monster' };

// A lethal third-failure death save: roll 5 (failure), 3 failures, isDead
const LETHAL_SAVE = {
  participantId: PLAYER_ID,
  roll: 5,
  isSuccess: false,
  isCritical: false,
  successes: 0,
  failures: 3,
  isDead: true,
};

describe('Death save real path (#2457)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({ text: 'The hero falls.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
    // The action execution returns a normal result (no death saves yet)
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: {},
      boundary: null,
    });
    // The end_turn returns a lethal third-failure save plus combat-ended marker
    executeAuthoritativeCombatIntent.mockResolvedValue({
      deathSaves: [LETHAL_SAVE],
      combatEnded: true,
      currentParticipant: null,
    });
    advanceNpcTurns.mockResolvedValue({
      results: [],
      currentParticipant: null,
      combatEnded: true,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    });
  });

  it('lethal third-failure end_turn produces DEAD line and card with Engine prefix, no Narrate text', async () => {
    // Use an attack action; the end_turn boundary (mocked above) carries the lethal save
    const attackAction = {
      actor_id: PLAYER_ID,
      action_type: 'attack' as const,
      target_ids: [MONSTER_ID],
      weapon_id: 'sword',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };

    const result = await resolveDeclaredCombatActions({
      encounterId: 'enc-2457',
      sessionId: 'session-2457',
      combatActions: [attackAction],
      declarationText: 'I attack the goblin.',
      aiContext: {},
      conversationHistory: [],
      participants: [PLAYER, MONSTER],
    } as any);

    // Collect all lines from engine blocks
    const blocks = result.combatEngineBlocks ?? [];
    const allLines = blocks.flatMap((b: any) => b.lines ?? []);
    const allCards = blocks.flatMap((b: any) => b.cards ?? []);
    const allText = JSON.stringify(result);

    // 1. DEAD line is present with the Engine prefix
    const deadLine = allLines.find(
      (line: string) => line.includes('DEAD') && line.includes('⚙️ Engine:'),
    );
    expect(deadLine).toBeDefined();
    expect(deadLine).toContain('⚙️ Engine:');

    // 2. DEAD card is present
    const deadCard = allCards.find((card: any) => JSON.stringify(card).includes('DEAD'));
    expect(deadCard).toBeDefined();

    // 3. No "Narrate" or "already happened" anywhere in the payload
    expect(allText).not.toContain('Narrate');
    expect(allText).not.toContain('already happened');
    for (const line of allLines) {
      expect(line).not.toContain('Narrate');
    }
  });

  it('recomputes the death tally from visible lines', async () => {
    const attackAction = {
      actor_id: PLAYER_ID,
      action_type: 'attack' as const,
      target_ids: [MONSTER_ID],
      weapon_id: 'sword',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };

    const result = await resolveDeclaredCombatActions({
      encounterId: 'enc-2457',
      sessionId: 'session-2457',
      combatActions: [attackAction],
      declarationText: 'I attack the goblin.',
      aiContext: {},
      conversationHistory: [],
      participants: [PLAYER, MONSTER],
    } as any);

    const blocks = result.combatEngineBlocks ?? [];
    const allLines = blocks.flatMap((b: any) => b.lines ?? []);

    // Parse the visible lines to count failures (not from the input)
    // The lethal line format: "{name} rolled {roll} on their death saving throw — the third failure. {name} is DEAD."
    const deathLines = allLines.filter(
      (line: string) => line.includes('⚙️ Engine:') && line.includes('death saving throw'),
    );
    expect(deathLines.length).toBeGreaterThan(0);

    // Parse the failure count from the line text
    // "the third failure" indicates 3 failures
    const lethalLine = deathLines.find((line: string) => line.includes('DEAD'));
    expect(lethalLine).toBeDefined();
    expect(lethalLine).toContain('the third failure');
    expect(lethalLine).toContain('DEAD');
  });
});
