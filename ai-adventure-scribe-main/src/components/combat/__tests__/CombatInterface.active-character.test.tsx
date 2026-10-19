/**
 * #752: outside a live encounter the combat tracker listed no players and showed
 * "No player characters found". The active character lives in CharacterContext, so the
 * pre-combat card reads the name from there instead of only the encounter participants.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CombatInterface from '../CombatInterface';

import { useCombatActions } from '@/hooks/use-combat-actions';

const characterState = vi.hoisted(() => ({
  character: { id: 'char-1', name: 'Stranger Abyss Tiefling' } as {
    id: string;
    name: string;
  } | null,
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: characterState, dispatch: vi.fn() }),
}));

vi.mock('@/hooks/use-combat-actions', () => ({ useCombatActions: vi.fn() }));

const noEncounter = () => ({
  state: { showCombatLog: false },
  activeEncounter: null,
  isInCombat: false,
  playerParticipants: [],
  enemyParticipants: [],
  playerCharacterId: undefined,
  isPlayersTurn: false,
  selectedEnemy: null,
  setSelectedEnemy: vi.fn(),
  showCombatMode: false,
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

describe('#752 CombatInterface pre-combat card', () => {
  beforeEach(() => {
    characterState.character = { id: 'char-1', name: 'Stranger Abyss Tiefling' };
    vi.mocked(useCombatActions).mockReturnValue(noEncounter() as never);
  });

  it('names the active character instead of the "no player characters" error', () => {
    render(<CombatInterface />);

    expect(screen.getByText('Party: Stranger Abyss Tiefling')).toBeInTheDocument();
    expect(
      screen.queryByText('No player characters found. Please ensure your character is selected.'),
    ).toBeNull();
  });

  it('still shows the error when no active character is selected', () => {
    characterState.character = null;

    render(<CombatInterface />);

    expect(
      screen.getByText('No player characters found. Please ensure your character is selected.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Party:/)).toBeNull();
  });
});
