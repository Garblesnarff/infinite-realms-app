import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * #2641 items 3 and 5 (run D9): "End turn" ended the player's turn and stopped. The server has no
 * auto-advance, so the creature that was up waited until the player typed something. The attack
 * chip beside it ran the NPC turns; this one did not.
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
  };
});
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combat, refreshCombatState: vi.fn().mockResolvedValue(null) }),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn(),
  executeStructuredCombatActionWithBoundary: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { advanceNpcTurns: vi.fn() },
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

/** One NPC attack as `advance-npc-turns` returns it (see the #2622 attack-pipeline fixture). */
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

describe('the End turn option runs the NPC turns that follow (#2641)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);
  const onSendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [{ type: 'end_turn', label: 'End turn' }],
      }),
    } as Response);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
      combatEnded: false,
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [swarmHitsScholar],
      currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
      combatEnded: false,
      iterationCount: 1,
      iterationCap: 6,
      capReached: false,
      transcriptLines: [],
    } as any);
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

  it('advances the creature that is up without writing the server-owned NPC row', async () => {
    await clickEndTurn();

    await waitFor(() => expect(userDataApi.advanceNpcTurns).toHaveBeenCalledTimes(1));
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', {
      type: 'end_turn',
      actorId: SCHOLAR_ID,
    });
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-d5', SWARM_1_ID);
    expect(onSendMessage).not.toHaveBeenCalled();
    // The chip never sends the label to the DM as typed text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('does not advance anyone when the end of the turn ended the fight', async () => {
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: null,
      combatEnded: true,
      endedReason: 'party_defeated',
    } as any);

    await clickEndTurn();

    await waitFor(() => expect(onSendMessage).toHaveBeenCalled());
    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
  });

  it('runs the creatures again when the server stopped at its safety cap with one still up', async () => {
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockResolvedValueOnce({
        results: [swarmHitsScholar],
        currentParticipant: {
          id: SWARM_1_ID,
          name: 'Light-Eater Swarm 1',
          participantType: 'monster',
        },
        combatEnded: false,
        iterationCount: 6,
        iterationCap: 6,
        capReached: true,
        transcriptLines: ['⚙️ Engine: NPC turn loop stopped after 6 iterations.'],
      } as any)
      .mockResolvedValueOnce({
        results: [],
        currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 6,
        capReached: false,
        transcriptLines: [],
      } as any);

    await clickEndTurn();

    await waitFor(() => expect(userDataApi.advanceNpcTurns).toHaveBeenCalledTimes(2));
    expect(userDataApi.advanceNpcTurns).toHaveBeenLastCalledWith('session-d5', SWARM_1_ID);
    const text = onSendMessage.mock.calls.map(([message]) => (message as { text: string }).text);
    // The fight is not paused any more, so the "stopped after" line is not left on screen.
    expect(text.join('\n')).not.toContain('stopped after');
  });
});
