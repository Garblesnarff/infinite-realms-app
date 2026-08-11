import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CombatInterface from '../CombatInterface';

import { useCombatActions } from '@/hooks/use-combat-actions';

vi.mock('@/hooks/use-combat-actions', () => ({
  useCombatActions: vi.fn(),
}));

vi.mock('../ActionPanel', () => ({ default: () => <div>Action panel</div> }));
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
});
