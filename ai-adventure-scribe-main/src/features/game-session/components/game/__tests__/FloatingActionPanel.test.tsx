/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FloatingActionPanel } from '../FloatingActionPanel';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCharacterStats } from '@/hooks/use-character-stats';
import logger from '@/lib/logger';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(),
}));

vi.mock('@/hooks/use-character-stats', () => ({
  useCharacterStats: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('FloatingActionPanel', () => {
  const mockOnToggle = vi.fn();

  const mockCharacter = {
    name: 'Gimli',
    level: 5,
    race: { name: 'Dwarf' },
    class: { name: 'Fighter' },
  };

  const mockStats = {
    hitPoints: 45,
    armorClass: 18,
    proficiencyBonus: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });
    (useCombat as any).mockReturnValue({
      state: {},
    });
    (useCharacterStats as any).mockReturnValue(mockStats);
  });

  it('renders nothing when no character is provided', () => {
    (useCharacter as any).mockReturnValue({
      state: { character: null },
    });

    const { container } = render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the collapsed trigger when not visible', () => {
    render(
      <FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={false} />
    );

    const button = screen.getByRole('button', { name: /open quick actions/i });
    expect(button).toBeDefined();

    fireEvent.click(button);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('renders with pulse animation in combat mode when collapsed', () => {
    render(
      <FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={true} />
    );

    const button = screen.getByRole('button', { name: /open quick actions/i });
    expect(button.className).toContain('animate-pulse');
    expect(button.className).toContain('border-red-400/50');
  });

  it('renders the full panel when visible', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );

    expect(screen.getByText(/quick actions/i)).toBeDefined();
    expect(screen.getByText('Gimli • Level 5')).toBeDefined();
    expect(screen.getByText('Dwarf Fighter')).toBeDefined();

    // Verify stats
    expect(screen.getByLabelText(/hit points: 45/i)).toBeDefined();
    expect(screen.getByLabelText(/armor class: 18/i)).toBeDefined();
    expect(screen.getByLabelText(/proficiency bonus: \+3/i)).toBeDefined();
  });

  it('toggles expansion state', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );

    // Should not show perception by default
    expect(screen.queryByTitle(/make a perception check/i)).toBeNull();

    const expandButton = screen.getByRole('button', { name: /expand actions/i });
    fireEvent.click(expandButton);

    expect(screen.getByTitle(/make a perception check/i)).toBeDefined();
    expect(screen.getByTitle(/make a stealth check/i)).toBeDefined();
    expect(screen.getByTitle(/make an investigation check/i)).toBeDefined();

    const collapseButton = screen.getByRole('button', { name: /collapse actions/i });
    fireEvent.click(collapseButton);
    expect(screen.queryByTitle(/make a perception check/i)).toBeNull();
  });

  it('shows combat actions when in combat mode', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={true} />
    );

    expect(screen.getByTitle(/roll initiative/i)).toBeDefined();
    expect(screen.getByTitle(/make an attack roll/i)).toBeDefined();
  });

  it('hides combat actions when not in combat mode', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );

    expect(screen.queryByTitle(/roll initiative/i)).toBeNull();
    expect(screen.queryByTitle(/make an attack roll/i)).toBeNull();
  });

  it('calls logger when quick roll buttons are clicked', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={true} />
    );

    fireEvent.click(screen.getByTitle(/roll a d20/i));
    expect(logger.info).toHaveBeenCalledWith('Quick rolling d20');

    fireEvent.click(screen.getByTitle(/roll initiative/i));
    expect(logger.info).toHaveBeenCalledWith('Quick rolling initiative');

    fireEvent.click(screen.getByTitle(/make an attack roll/i));
    expect(logger.info).toHaveBeenCalledWith('Quick rolling attack');
  });

  it('calls onToggle when close button is clicked', () => {
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );

    const closeButton = screen.getByRole('button', { name: /close quick actions/i });
    fireEvent.click(closeButton);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('handles missing stats gracefully', () => {
    (useCharacterStats as any).mockReturnValue(null);

    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />
    );

    // Should use default values: maxHp: 0, armorClass: 10, proficiency: 2
    expect(screen.getByLabelText(/hit points: 0/i)).toBeDefined();
    expect(screen.getByLabelText(/armor class: 10/i)).toBeDefined();
    expect(screen.getByLabelText(/proficiency bonus: \+2/i)).toBeDefined();
  });
});
