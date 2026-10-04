import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { userDataApi } from '@/services/user-data-api';

/**
 * #2563, run D5 round 2: the "Attack with Quarterstaff" chip used to send
 * "I attack with Quarterstaff against Light-Eater Swarm 1." as chat text, making
 * the DM the first to see the attack — and when the DM's envelope failed to carry
 * the swing through, no die was ever rolled. The chip now runs the declare →
 * dialog → commit pipeline itself, against the legal action's engine ids.
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
vi.mock('@/services/combat/player-attack-roll', () => ({
  askPlayerForAttackDie: vi.fn(),
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

describe('the attack option runs the declare pipeline, never DM text (#2563)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [
          {
            type: 'attack',
            label: 'Attack with Quarterstaff',
            weaponId: 'quarterstaff',
            targetIds: [SWARM_1_ID],
          },
        ],
      }),
    } as Response);
    vi.mocked(askPlayerForAttackDie).mockResolvedValue({
      d20: 15,
      autoRolled: false,
      movementOnly: false,
    });
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 2, newHp: 2 }],
      boundary: null,
      result: { hit: true },
    } as any);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({ results: [] } as any);
  });

  it('opens the dialog and posts the declare intent with the engine id', async () => {
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(askPlayerForAttackDie).toHaveBeenCalled());
    expect(askPlayerForAttackDie).toHaveBeenCalledWith({
      encounterId: 'encounter-d5',
      action: {
        actor_id: SCHOLAR_ID,
        action_type: 'attack',
        target_ids: [SWARM_1_ID],
        weapon_id: 'quarterstaff',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      actorLabel: 'The Scholar',
    });
    // The commit carries the player's own die; the turn then settles and the NPCs run.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ target_ids: [SWARM_1_ID], weapon_id: 'quarterstaff' }),
      15,
      'action_bar',
    );
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', {
      type: 'end_turn',
      actorId: SCHOLAR_ID,
    });
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-d5', SWARM_1_ID);
    // The DM never sees this attack as text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('a movement-only approach spends no Action and keeps the turn open', async () => {
    vi.mocked(askPlayerForAttackDie).mockResolvedValue({
      autoRolled: false,
      movementOnly: true,
    });
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [],
      boundary: null,
      result: { resolvedAs: 'movement_only' },
    } as any);
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ type: 'end_turn' }),
    );
    expect(onOptionSelect).not.toHaveBeenCalled();
  });
});
