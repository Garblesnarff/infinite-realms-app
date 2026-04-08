import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import CombatActionPanel from '../CombatActionPanel';

// Mock the context
const mockCombatContext = {
  state: {
    activeEncounter: {
      participants: [
        {
          id: '1',
          name: 'Hero',
          actionTaken: false,
          bonusActionTaken: false,
          reactionTaken: false,
          conditions: [],
          movementUsed: 0
        }
      ],
      currentTurnParticipantId: '1',
      currentRound: 1,
      roundsElapsed: 0
    },
    isInCombat: true,
  },
  applyCondition: vi.fn(),
  removeCondition: vi.fn(),
  moveParticipant: vi.fn(),
  nextTurn: vi.fn(),
  rollInitiative: vi.fn(),
};

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => mockCombatContext
}));

// Mock child components
vi.mock('../actions/CombatActionGrid', () => ({
  CombatActionGrid: () => <div data-testid="action-grid" />
}));

vi.mock('../ConditionApplicationPanel', () => ({
  ConditionApplicationPanel: () => <div data-testid="condition-panel" />
}));

vi.mock('@/components/spellcasting/SpellSlotPanel', () => ({
  default: () => <div data-testid="spell-panel" />
}));

describe('CombatActionPanel UX Improvements', () => {
  it('toggles management panel and updates accessibility attributes', async () => {
    render(
      <CombatActionPanel onActionSubmit={vi.fn()} />
    );

    // Find "Manage Conditions" button (from MANAGEMENT_ACTIONS in ActionDefinitions)
    // The button text is "Manage Conditions" but it's sliced in the component: {action.name.replace('Manage ', '')}
    const manageButton = screen.getByRole('button', { name: /manage conditions/i });

    // Initial state
    expect(manageButton.getAttribute('aria-pressed')).toBe('false');
    expect(manageButton).not.toHaveClass('bg-purple-600');
    expect(screen.queryByTestId('condition-panel')).toBeNull();

    // Click to open
    fireEvent.click(manageButton);
    expect(manageButton.getAttribute('aria-pressed')).toBe('true');
    expect(manageButton).toHaveClass('bg-purple-600');
    expect(screen.getByTestId('condition-panel')).toBeDefined();

    // Click to close (toggle functionality)
    fireEvent.click(manageButton);
    expect(manageButton.getAttribute('aria-pressed')).toBe('false');
    expect(manageButton).not.toHaveClass('bg-purple-600');
    expect(screen.queryByTestId('condition-panel')).toBeNull();
  });
});
