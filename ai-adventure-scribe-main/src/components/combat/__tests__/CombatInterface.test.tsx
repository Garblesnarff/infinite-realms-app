import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CombatInterface from '../CombatInterface';

import { useCombatActions } from '@/hooks/use-combat-actions';

vi.mock('@/hooks/use-combat-actions', () => ({
  useCombatActions: vi.fn(),
}));

vi.mock('../CombatReadyCard', () => ({ CombatReadyCard: () => <div>Combat ready</div> }));
vi.mock('../EnemyCard', () => ({ default: () => <div>Enemy card</div> }));
vi.mock('../HPTracker', () => ({ default: () => <div>HP tracker</div> }));
vi.mock('../InitiativeTracker', () => ({ default: () => <div>Initiative tracker</div> }));
vi.mock('../ReactionOpportunityPanel', () => ({
  default: () => <div>Reaction opportunities</div>,
}));

const mockCombatActions = () => ({
  state: { showCombatLog: false },
  activeEncounter: {
    id: 'encounter-1',
    currentRound: 2,
    currentTurnParticipantId: null,
    actions: [],
    participants: [],
  },
  isInCombat: true,
  playerParticipants: [],
  enemyParticipants: [],
  playerCharacterId: undefined,
  isPlayersTurn: false,
  selectedEnemy: null,
  setSelectedEnemy: vi.fn(),
  showCombatMode: true,
  isStartingCombat: false,
  actionValidation: null,
  reactionOpportunities: [],
  setReactionOpportunities: vi.fn(),
  localShowInitiativeTracker: true,
  setLocalShowInitiativeTracker: vi.fn(),
  handleStartCombat: vi.fn(),
  handleEndCombat: vi.fn(),
  handleCombatAction: vi.fn(),
  handleEnemyAttack: vi.fn(),
  addEnemy: vi.fn(),
  handleEnhancedAttack: vi.fn(),
  handleRacialTraitUse: vi.fn(),
  handleClassFeature: vi.fn(),
  handleReactionOpportunity: vi.fn(),
  handleDeathSave: vi.fn(),
  handleConcentrationSave: vi.fn(),
  handleTwoWeaponAttack: vi.fn(),
  handleApplyDamage: vi.fn(),
  handleHealing: vi.fn(),
  nextTurn: vi.fn(),
  rollInitiative: vi.fn(),
  showAdvantageModal: false,
  setShowAdvantageModal: vi.fn(),
  pendingAttack: null,
  setPendingAttack: vi.fn(),
});

describe('CombatInterface', () => {
  beforeEach(() => {
    vi.mocked(useCombatActions).mockReturnValue(mockCombatActions() as never);
  });

  it('renders the reopened mid-combat tracker and party status', () => {
    render(<CombatInterface />);

    expect(screen.getByRole('button', { name: 'Hide initiative tracker' })).toBeInTheDocument();
    expect(screen.getByText('Initiative tracker')).toBeInTheDocument();
    expect(screen.getByText('Party Status')).toBeInTheDocument();
  });

  // The action buttons are game-master controls now (#2257): the player view has none, so this
  // renders the gated GM surface (`isDM`), which still owns them.
  it('re-enables every combat action after a move-only action and NPC hit hand the turn back', () => {
    const player = {
      id: 'player-1',
      name: 'Rook',
      participantType: 'player',
      characterId: 'character-1',
      currentHitPoints: 20,
      maxHitPoints: 20,
    };
    const npc = {
      id: 'npc-1',
      name: 'Goblin',
      participantType: 'monster',
      currentHitPoints: 2,
      maxHitPoints: 7,
    };
    const encounter = {
      id: 'encounter-1',
      currentRound: 2,
      currentTurnParticipantId: 'npc-1',
      actions: [{ action_type: 'move', actor_id: 'player-1' }],
      participants: [player, npc],
    };
    const npcHitEncounter = {
      ...encounter,
      currentTurnParticipantId: 'player-1',
      actions: [
        ...encounter.actions,
        {
          action_type: 'attack',
          actor_id: 'npc-1',
          target_ids: ['player-1'],
          outcomes: [{ participantId: 'player-1', hit: true, finalDamage: 3, newHp: 17 }],
        },
      ],
    };

    vi.mocked(useCombatActions).mockReturnValue({
      ...mockCombatActions(),
      activeEncounter: encounter,
      playerParticipants: [player],
      enemyParticipants: [npc],
      isPlayersTurn: false,
    } as never);
    const { rerender } = render(<CombatInterface isDM />);

    expect(screen.queryByText("Rook's Turn")).toBeNull();

    vi.mocked(useCombatActions).mockReturnValue({
      ...mockCombatActions(),
      activeEncounter: npcHitEncounter,
      playerParticipants: [player],
      enemyParticipants: [npc],
      isPlayersTurn: true,
    } as never);
    rerender(<CombatInterface isDM />);

    expect(screen.getByText("Rook's Turn")).toBeInTheDocument();
    for (const action of [
      'Grapple',
      'Shove',
      'Two-Weapon Attack',
      'Dash',
      'Dodge',
      'Help',
      'Hide',
      'Ready Action',
      'Cast Spell',
    ]) {
      expect(screen.getByRole('button', { name: action })).toBeEnabled();
    }
  });
});
