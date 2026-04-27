/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatStatus } from '../CombatStatus';

import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';

// Mock the contexts
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

describe('CombatStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockGameState = {
    currentPhase: 'exploration',
    diceRollQueue: {
      pendingRolls: [],
    },
  };

  const mockCombatState = {
    isInCombat: false,
    activeEncounter: null,
  };

  it('renders exploration phase by default', () => {
    vi.mocked(useGame).mockReturnValue({ state: mockGameState } as any);
    vi.mocked(useCombat).mockReturnValue({ state: mockCombatState } as any);

    render(<CombatStatus />);

    expect(screen.getByText('Exploration')).toBeDefined();
  });

  it('displays different phases correctly', () => {
    const phases = [
      { phase: 'combat', label: 'Combat' },
      { phase: 'social', label: 'Social' },
      { phase: 'puzzle', label: 'Puzzle' },
      { phase: 'rest', label: 'Rest' },
    ];

    phases.forEach(({ phase, label }) => {
      vi.mocked(useGame).mockReturnValue({
        state: { ...mockGameState, currentPhase: phase }
      } as any);
      vi.mocked(useCombat).mockReturnValue({ state: mockCombatState } as any);

      const { unmount } = render(<CombatStatus />);
      expect(screen.getByText(label)).toBeDefined();
      unmount();
    });
  });

  it('displays active participant info when in combat', () => {
    const combatEncounter = {
      participants: [
        {
          id: 'p1',
          name: 'Hero',
          initiative: { value: 15 },
          hitPoints: { current: 20, maximum: 20 }
        }
      ],
      currentTurnParticipantId: 'p1',
      round: 1
    };

    vi.mocked(useGame).mockReturnValue({
      state: { ...mockGameState, currentPhase: 'combat' }
    } as any);
    vi.mocked(useCombat).mockReturnValue({
      state: {
        isInCombat: true,
        activeEncounter: combatEncounter
      }
    } as any);

    render(<CombatStatus />);

    expect(screen.getByText('Hero')).toBeDefined();
    expect(screen.getByText('Init 15')).toBeDefined();
    expect(screen.getByText('20/20')).toBeDefined();
    expect(screen.getByText('Round 1')).toBeDefined();
  });

  it('displays pending rolls count', () => {
    const gameStateWithRolls = {
      ...mockGameState,
      diceRollQueue: {
        pendingRolls: [
          { id: 'r1', status: 'pending' },
          { id: 'r2', status: 'pending' },
          { id: 'r3', status: 'completed' },
        ],
      },
    };

    vi.mocked(useGame).mockReturnValue({ state: gameStateWithRolls } as any);
    vi.mocked(useCombat).mockReturnValue({ state: mockCombatState } as any);

    render(<CombatStatus />);

    expect(screen.getByText('2 rolls pending')).toBeDefined();
  });

  it('handles unknown phase', () => {
    vi.mocked(useGame).mockReturnValue({
      state: { ...mockGameState, currentPhase: 'unknown' }
    } as any);
    vi.mocked(useCombat).mockReturnValue({ state: mockCombatState } as any);

    render(<CombatStatus />);

    expect(screen.getByText('Unknown')).toBeDefined();
  });
});
