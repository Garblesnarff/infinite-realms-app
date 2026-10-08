import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';

/**
 * #2641 items 3 and 5 (run D9): "End turn" ended the player's turn and stopped, and the creature
 * that was up waited until the player typed something. Since #2658 step 3 the server runs those
 * creatures inside the End turn request itself: the chip sends one keyed end_turn and makes no
 * second call, and every row (the boundary's and each creature's) is the server's.
 */
const SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';

const combat = vi.hoisted(() => {
  const SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
  const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';
  const SWARM_2_ID = 'a0ee13a2-0000-4000-8000-000000000003';
  return {
    isInCombat: true,
    activeEncounter: {
      id: 'encounter-d5',
      sessionId: 'session-d5',
      currentRound: 2,
      currentTurnParticipantId: SCHOLAR_ID,
      participants: [
        { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        { id: SWARM_1_ID, name: 'Light-Eater Swarm 1', participantType: 'monster' },
        { id: SWARM_2_ID, name: 'Light-Eater Swarm 2', participantType: 'monster' },
      ],
    } as any,
    refreshCombatState: null as any,
  };
});
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combat, refreshCombatState: combat.refreshCombatState }),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn(),
  executeStructuredCombatActionWithBoundary: vi.fn(),
}));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[]; onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

/** One NPC attack as the server's drain reports it (the AdvanceNpcTurnsResult `results` entry). */
const swarmHitsScholar = {
  action: {
    actor_id: SWARM_1_ID,
    action_type: 'attack',
    target_ids: [SCHOLAR_ID],
    weapon_id: null,
    spell_id: null,
    slot_level: null,
    movement_feet: 0,
  },
  round: 2,
  engineResult: {
    actorName: 'Light-Eater Swarm 1',
    targetName: 'The Scholar',
    hit: true,
    finalDamage: 2,
    targetNewHp: 8,
    targetIsConscious: true,
  },
  outcomes: [{ participantId: SCHOLAR_ID, hit: true, finalDamage: 2, newHp: 8 }],
  actorIsPlayer: false,
  transcriptLines: [],
};

/**
 * `payload.result` of the intent route for a player's End turn: the boundary's own result, the
 * creatures the server ran after it (`npcTurns`), and every row it wrote (`engineRows`).
 */
const endTurnResult = (npcTurns: Record<string, unknown> | undefined, extra = {}) => ({
  newRound: false,
  roundNumber: 2,
  currentParticipant: { id: SWARM_1_ID },
  previousParticipant: { id: SCHOLAR_ID },
  actionId: 'end-turn-action',
  engineRows: [],
  sessionId: 'session-d5',
  ...(npcTurns ? { npcTurns } : {}),
  ...extra,
});

const keyedEndTurn = {
  type: 'end_turn',
  actorId: SCHOLAR_ID,
  actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
};

describe('the End turn option leaves the NPC turns to the server (#2641, #2658 step 3)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);
  const onSendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    combat.refreshCombatState = vi.fn().mockResolvedValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [{ type: 'end_turn', label: 'End turn' }],
      }),
    } as Response);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue(
      endTurnResult({
        results: [swarmHitsScholar],
        currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        round: 2,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 6,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      }) as any,
    );
  });

  const clickEndTurn = async () => {
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('End turn'));
  };

  // Migrated (#2658 step 3): was "advances the creature that is up without writing the server-owned NPC row"
  it('sends one keyed End turn and no second call: the server ran the creature that was up', async () => {
    await clickEndTurn();

    await waitFor(() => expect(combat.refreshCombatState).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', keyedEndTurn);
    expect(onSendMessage).not.toHaveBeenCalled();
    // The chip never sends the label to the DM as typed text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  // Migrated (#2658 step 3): was "does not advance anyone when the end of the turn ended the fight"
  it('writes no client line when the end of the turn ended the fight: the end reason is in the server row', async () => {
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue(
      endTurnResult(undefined, {
        currentParticipant: null,
        combatEnded: true,
        endedReason: 'party_defeated',
      }) as any,
    );

    await clickEndTurn();

    await waitFor(() => expect(combat.refreshCombatState).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  // Migrated (#2658 step 3): was "runs the creatures again when the server stopped at its safety cap with one still up"
  it('asks for no continuation when the server had to continue past its safety cap', async () => {
    // The server's drain continued past the per-call cap and handed the turn back: one response
    // with both batches' iterations, and no cap line, because the fight is not paused.
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue(
      endTurnResult({
        results: [swarmHitsScholar],
        currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        round: 3,
        combatEnded: false,
        iterationCount: 7,
        iterationCap: 6,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      }) as any,
    );

    await clickEndTurn();

    await waitFor(() => expect(combat.refreshCombatState).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    const text = onSendMessage.mock.calls.map(([message]) => (message as { text: string }).text);
    // The fight is not paused any more, so the "stopped after" line is not left on screen.
    expect(text.join('\n')).not.toContain('stopped after');
  });
});
