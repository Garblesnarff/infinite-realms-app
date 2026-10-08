/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

/**
 * #2457: Real-path test for death save engine lines.
 *
 * Drives `resolveDeclaredCombatActions` (the real client path) with an `end_turn`
 * whose server result contains a lethal third-failure death save plus the
 * combat-ended marker. Since #2658 step 3 the keyed End turn is a server row: the
 * server formats that result with `buildNpcEngineMessage` (its real producer, run
 * here on the same result) and the client embeds no copy of its own. Asserts:
 * - The DEAD line is in the row with the "⚙️ Engine:" prefix
 * - The DEAD card is present
 * - No "Narrate" or "already happened" text appears anywhere in the payload
 *   (lines, covers, engineResult)
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();

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

const END_TURN_RESULT = {
  deathSaves: [LETHAL_SAVE],
  combatEnded: true,
  currentParticipant: null,
};

/** The row the server writes for that keyed End turn (npc-engine-row.ts → buildNpcEngineMessage). */
const serverRow = () =>
  buildNpcEngineMessage(
    [PLAYER, MONSTER],
    1,
    { type: 'end_turn', actorId: PLAYER_ID },
    END_TURN_RESULT,
  );

const attackAction = {
  actor_id: PLAYER_ID,
  action_type: 'attack' as const,
  target_ids: [MONSTER_ID],
  weapon_id: 'sword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const resolve = () =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-2457',
    sessionId: 'session-2457',
    combatActions: [attackAction],
    declarationText: 'I attack the goblin.',
    aiContext: {},
    conversationHistory: [],
    participants: [PLAYER, MONSTER],
  } as any);

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
    executeAuthoritativeCombatIntent.mockResolvedValue(END_TURN_RESULT);
  });

  // Migrated (#2658 step 3): was "lethal third-failure end_turn produces DEAD line and card with Engine prefix, no Narrate text"
  it('lethal third-failure End turn: the server row carries the DEAD line and card, the client embeds no copy', async () => {
    const result = await resolve();

    // The End turn is keyed, which is what makes the server write (and dedupe) its row.
    expect(executeAuthoritativeCombatIntent.mock.calls[0][1]).toMatchObject({
      type: 'end_turn',
      actorId: PLAYER_ID,
      actionId: expect.any(String),
    });
    const row = serverRow();
    const rowLines = row.context.combatEngineBlocks.flatMap((block) => block.lines);

    // 1. DEAD line is present with the Engine prefix
    const deadLine = rowLines.find(
      (line: string) => line.includes('DEAD') && line.includes('⚙️ Engine:'),
    );
    expect(deadLine).toBeDefined();
    expect(deadLine).toContain('⚙️ Engine:');

    // 2. DEAD card is present
    const deadCard = row.context.engineCards.find((card: any) =>
      JSON.stringify(card).includes('DEAD'),
    );
    expect(deadCard).toBeDefined();

    // 3. No "Narrate" or "already happened" anywhere in the row or the client payload
    const allText = JSON.stringify(row) + JSON.stringify(result);
    expect(allText).not.toContain('Narrate');
    expect(allText).not.toContain('already happened');
    for (const line of rowLines) {
      expect(line).not.toContain('Narrate');
    }

    // 4. The client's own blocks hold no second death-save line.
    const clientLines = (result.combatEngineBlocks ?? []).flatMap((b: any) => b.lines ?? []);
    expect(clientLines.filter((line: string) => line.includes('death saving throw'))).toEqual([]);
  });

  // Migrated (#2658 step 3): was "recomputes the death tally from visible lines"
  it('recomputes the death tally from the visible lines of the server row', async () => {
    await resolve();

    const rowLines = serverRow().context.combatEngineBlocks.flatMap((block) => block.lines);

    // Parse the visible lines to count failures (not from the input)
    // The lethal line format: "{name} rolled {roll} on their death saving throw — the third failure. {name} is DEAD."
    const deathLines = rowLines.filter(
      (line: string) => line.includes('⚙️ Engine:') && line.includes('death saving throw'),
    );
    expect(deathLines.length).toBeGreaterThan(0);

    // "the third failure" indicates 3 failures
    const lethalLine = deathLines.find((line: string) => line.includes('DEAD'));
    expect(lethalLine).toBeDefined();
    expect(lethalLine).toContain('the third failure');
    expect(lethalLine).toContain('DEAD');
  });
});
