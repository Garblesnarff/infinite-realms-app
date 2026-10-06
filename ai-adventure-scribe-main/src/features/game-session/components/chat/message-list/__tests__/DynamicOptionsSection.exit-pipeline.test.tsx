import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
  EXIT_ENCOUNTER_ID,
  EXIT_SCHOLAR_ID,
  playerExitIntentBody,
} from '../../../../../../../shared/test-fixtures/player-exit-intent';
import { DynamicOptionsSection } from '../DynamicOptionsSection';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';

/**
 * #2580: the way OUT of a fight the DM's end guard holds open, as a player-facing control.
 *
 * Before this the combat menu offered Attack, cast, Dash, Dodge, Disengage and End turn, and no
 * option ended the player's participation: a fight the player wanted out of could only be left by
 * killing everything. These assert the chips commit the real intent through the real executor \u2014
 * the same pipeline the attack chip uses since #2563 \u2014 and that the one-line confirm is shown for
 * the case the rules make it cost something.
 */
const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';

const combat = vi.hoisted(() => {
  const SCHOLAR = 'e7e569df-0000-4000-8000-000000000001';
  const SWARM = 'faea28f4-0000-4000-8000-000000000002';
  return {
    isInCombat: true,
    // The encounter id is the fixture's, not a local literal: the assertions below compare the
    // posted body against `playerExitIntentBody`, and two ids for one encounter would let the
    // comparison pass for the wrong reason.
    activeEncounter: {
      id: '3232069e-0000-4000-8000-000000000001',
      sessionId: 'session-d5',
      currentRound: 2,
      currentTurnParticipantId: SCHOLAR,
      participants: [
        { id: SCHOLAR, name: 'The Scholar', participantType: 'player' },
        { id: SWARM, name: 'Light-Eater Swarm 1', participantType: 'monster' },
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
vi.mock('@/services/combat/player-attack-roll', () => ({ askPlayerForAttackDie: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { advanceNpcTurns: vi.fn() } }));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[]; onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt: any, i: number) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

const legalActionsFor = (actions: Array<Record<string, unknown>>) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ actorId: EXIT_SCHOLAR_ID, actions }),
  } as Response);

describe('Flee and Yield are options the player can actually take (#2580)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({} as any);
    legalActionsFor([
      { type: 'attack', label: 'Attack with Quarterstaff', weaponId: 'quarterstaff', targetIds: [SWARM_1_ID] },
      { type: 'flee', label: 'Flee (Light-Eater Swarm 1 attacks)' },
      { type: 'yield', label: 'Yield' },
      { type: 'end_turn', label: 'End turn' },
    ]);
  });

  it('serializes the exact body the intent route contract accepts', async () => {
    // Asserted on the wire, not on the executor's arguments: the executor fills the encounter
    // version itself, and the server suite posts the same fixture through the real route, so the
    // two halves of this change cannot drift without one of them going red. This is the shape
    // #2349's fixture got wrong by omitting a field the producer always sets.
    const sent: unknown[] = [];
    legalActionsFor([
      { type: 'flee', label: 'Flee' },
      { type: 'yield', label: 'Yield' },
    ]);
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation(async (encounterId, intent) => {
      sent.push(intent);
      return { encounterId } as never;
    });
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Yield'));

    await waitFor(() => expect(sent).toHaveLength(1));
    // The intent half: the same fields, minus the version the executor reads for itself.
    const { expectedVersion: _read, ...intent } = playerExitIntentBody('yield').intent;
    expect(sent[0]).toEqual(intent);
  });

  it('commits the flee intent through the executor, never as DM text', async () => {
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Flee (Light-Eater Swarm 1 attacks)'));

    await waitFor(() => expect(executeAuthoritativeCombatIntent).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      EXIT_ENCOUNTER_ID,
      { type: 'flee', actorId: EXIT_SCHOLAR_ID },
      'dm',
      expect.any(Number),
      'action_bar',
    );
    // The DM never sees an exit as prose, so it cannot narrate a run that never happened.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('warns, in one line, that a hostile in reach gets its attack', async () => {
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Flee (Light-Eater Swarm 1 attacks)'));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(window.confirm).toHaveBeenCalledWith(
      'Flee? Light-Eater Swarm 1 gets one attack as you turn.',
    );
  });

  it('a declined confirm flees nobody: nothing is posted', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Flee (Light-Eater Swarm 1 attacks)'));

    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
  });

  it('a flee with nothing in reach asks nothing, and costs nothing to ask', async () => {
    legalActionsFor([
      { type: 'flee', label: 'Flee' },
      { type: 'yield', label: 'Yield' },
    ]);
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Flee'));

    await waitFor(() => expect(executeAuthoritativeCombatIntent).toHaveBeenCalled());
    // No prompt on the common case: the confirm exists to price the opportunity attack, and
    // there is none to price.
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('Yield commits its own slug and provokes no confirm at all', async () => {
    render(<DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />);
    fireEvent.click(await screen.findByText('Yield'));

    await waitFor(() => expect(executeAuthoritativeCombatIntent).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      EXIT_ENCOUNTER_ID,
      { type: 'yield', actorId: EXIT_SCHOLAR_ID },
      'dm',
      expect.any(Number),
      'action_bar',
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
