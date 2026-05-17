/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CombatSummary } from '../CombatSummary';

import { useCombat } from '@/contexts/CombatContext';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  Sword: () => <div data-testid="sword-icon" />,
  Zap: () => <div data-testid="zap-icon" />,
  Clock: () => <div data-testid="clock-icon" />,
  Scroll: () => <div data-testid="scroll-icon" />,
  Users: () => <div data-testid="users-icon" />,
  Swords: () => <div data-testid="swords-icon" />,
  BookOpen: () => <div data-testid="book-open-icon" />,
  Sparkles: () => <div data-testid="sparkles-icon" />,
  Dice6: () => <div data-testid="dice-6-icon" />,
  Map: () => <div data-testid="map-icon" />,
}));

// Mock CombatContext
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

// Mock hp-utils
vi.mock('@/utils/hp-utils', () => ({
  getHPColor: vi.fn(() => 'bg-green-500'),
}));

describe('CombatSummary', () => {
  const mockNextTurn = vi.fn();
  const mockEndCombat = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when not in combat', () => {
    (useCombat as any).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      nextTurn: mockNextTurn,
      endCombat: mockEndCombat,
    });

    render(<CombatSummary />);
    expect(screen.getByText('No active combat')).toBeInTheDocument();
    expect(screen.getByText(/When combat starts/)).toBeInTheDocument();
  });

  it('renders combat summary when combat is active', () => {
    const mockEncounter = {
      currentRound: 1,
      currentTurnParticipantId: 'p1',
      participants: [
        {
          id: 'p1',
          name: 'Hero',
          participantType: 'player',
          currentHitPoints: 10,
          maxHitPoints: 10,
          armorClass: 15,
          initiative: 20,
          conditions: [],
          actionTaken: false,
          bonusActionTaken: false,
          reactionTaken: false,
        },
        {
          id: 'p2',
          name: 'Goblin',
          participantType: 'monster',
          currentHitPoints: 5,
          maxHitPoints: 7,
          armorClass: 12,
          initiative: 10,
          conditions: [{ name: 'Prone' }],
          actionTaken: false,
          bonusActionTaken: false,
          reactionTaken: false,
        },
      ],
      actions: [],
    };

    (useCombat as any).mockReturnValue({
      state: { isInCombat: true, activeEncounter: mockEncounter },
      nextTurn: mockNextTurn,
      endCombat: mockEndCombat,
    });

    render(<CombatSummary />);

    expect(screen.getByText('Combat Round 1')).toBeInTheDocument();
    expect(screen.getByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('Goblin')).toBeInTheDocument();
    expect(screen.getByText('Init: 20')).toBeInTheDocument();
    expect(screen.getByText('Init: 10')).toBeInTheDocument();
    expect(screen.getByText('HP: 10/10')).toBeInTheDocument();
    expect(screen.getByText('HP: 5/7')).toBeInTheDocument();
    expect(screen.getByText('AC: 15')).toBeInTheDocument();
    expect(screen.getByText('AC: 12')).toBeInTheDocument();
    expect(screen.getByText('Prone')).toBeInTheDocument();
    expect(screen.getByText('Current Turn')).toBeInTheDocument();

    // Verify NPC styling (red-200 border/red-50 bg)
    const npcItem = screen.getByLabelText('Goblin').closest('div');
    expect(npcItem?.className).toContain('border-red-200');
    expect(npcItem?.className).toContain('bg-red-50');
  });

  it('calls nextTurn and endCombat when buttons are clicked', () => {
    const mockEncounter = {
      currentRound: 1,
      participants: [],
      actions: [],
    };

    (useCombat as any).mockReturnValue({
      state: { isInCombat: true, activeEncounter: mockEncounter },
      nextTurn: mockNextTurn,
      endCombat: mockEndCombat,
    });

    render(<CombatSummary />);

    fireEvent.click(screen.getByText('Next Turn'));
    expect(mockNextTurn).toHaveBeenCalled();

    fireEvent.click(screen.getByText('End Combat'));
    expect(mockEndCombat).toHaveBeenCalled();
  });

  it('renders recent actions correctly', () => {
    const mockEncounter = {
      currentRound: 1,
      participants: [],
      actions: [
        { id: 'a1', description: 'Hero hits Goblin' },
        { id: 'a2', description: 'Goblin misses Hero' },
      ],
    };

    (useCombat as any).mockReturnValue({
      state: { isInCombat: true, activeEncounter: mockEncounter },
      nextTurn: mockNextTurn,
      endCombat: mockEndCombat,
    });

    render(<CombatSummary />);

    expect(screen.getByText('Recent Actions')).toBeInTheDocument();
    expect(screen.getByText('Hero hits Goblin')).toBeInTheDocument();
    expect(screen.getByText('Goblin misses Hero')).toBeInTheDocument();
  });

  it('displays turn summary for current participant', () => {
    const mockEncounter = {
      currentRound: 1,
      currentTurnParticipantId: 'p1',
      participants: [
        {
          id: 'p1',
          name: 'Hero',
          actionTaken: true,
          bonusActionTaken: false,
          reactionTaken: true,
          currentHitPoints: 10,
          maxHitPoints: 10,
          armorClass: 15,
          initiative: 20,
          conditions: [],
          participantType: 'player',
        },
      ],
      actions: [],
    };

    (useCombat as any).mockReturnValue({
      state: { isInCombat: true, activeEncounter: mockEncounter },
      nextTurn: mockNextTurn,
      endCombat: mockEndCombat,
    });

    render(<CombatSummary />);

    expect(screen.getByText('Current: Hero')).toBeInTheDocument();
    expect(screen.getByText(/Action: Used \| Bonus: Available \| Reaction: Used/)).toBeInTheDocument();
  });
});
