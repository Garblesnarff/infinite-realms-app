/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FloatingActionPanel } from '../FloatingActionPanel';

import type { CharacterStatsRow } from '@/utils/character/data-transformers';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useCharacterStats } from '@/hooks/use-character-stats';
import logger from '@/lib/logger';
import { buildStarterCharacterSeed } from '@/services/character/starter-character-seeding';
import { transformCharacterData } from '@/utils/character/data-transformers';

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
    character_stats: {
      current_hit_points: 31,
      max_hit_points: 45,
    },
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
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the collapsed trigger when not visible', () => {
    render(<FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={false} />);

    const button = screen.getByRole('button', { name: /open quick actions/i });
    expect(button).toBeDefined();

    fireEvent.click(button);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('renders with pulse animation in combat mode when collapsed', () => {
    render(<FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={true} />);

    const button = screen.getByRole('button', { name: /open quick actions/i });
    expect(button.className).toContain('animate-pulse');
    expect(button.className).toContain('border-red-400/50');
  });

  it('renders the full panel when visible', () => {
    render(<FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />);

    expect(screen.getByText(/quick actions/i)).toBeDefined();
    expect(screen.getByText('Gimli • Level 5')).toBeDefined();
    expect(screen.getByText('Dwarf Fighter')).toBeDefined();

    // Verify stats
    expect(screen.getByLabelText(/hit points: 31 out of 45/i)).toBeDefined();
    expect(screen.getByLabelText(/armor class: 18/i)).toBeDefined();
    expect(screen.getByLabelText(/proficiency bonus: \+3/i)).toBeDefined();
  });

  it.each([false, true])('has no log-only control in combat mode %s', async (combatMode) => {
    const seed = buildStarterCharacterSeed(
      {
        name: 'The Veteran',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        ability_scores: {
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
        equipment: ['chain mail', 'shield'],
      },
      'abyssal-descent',
    );
    vi.mocked(useCharacter).mockReturnValue({
      state: {
        character: transformCharacterData(
          {
            id: 'panel-character',
            user_id: 'panel-user',
            name: seed.name,
            race: 'Human',
            class: 'Fighter',
            level: 1,
          },
          seed.stats as CharacterStatsRow,
          [],
        ),
      },
    } as ReturnType<typeof useCharacter>);
    const actualStats = await vi.importActual<{ useCharacterStats: typeof useCharacterStats }>(
      '@/hooks/use-character-stats',
    );
    vi.mocked(useCharacterStats).mockImplementation(actualStats.useCharacterStats);
    render(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={combatMode} />,
    );

    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Close Quick Actions']);
    expect(
      screen.queryByRole('button', { name: /roll|initiative|perception|stealth|investigation/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /close quick actions/i }));
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('calls onToggle when close button is clicked', () => {
    render(<FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />);

    const closeButton = screen.getByRole('button', { name: /close quick actions/i });
    fireEvent.click(closeButton);
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('handles missing stats gracefully', () => {
    (useCharacterStats as any).mockReturnValue(null);

    render(<FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} />);

    // Stored HP remains available while missing AC stays visibly unavailable.
    expect(screen.getByLabelText(/hit points: 31 out of 45/i)).toBeDefined();
    expect(screen.getByLabelText(/armor class: —/i)).toBeDefined();
    expect(screen.getByLabelText(/proficiency bonus: \+2/i)).toBeDefined();
  });

  it('sits inside its container instead of fixed to the viewport when anchored (#2281)', () => {
    const { container, rerender } = render(
      <FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={false} anchored />,
    );
    expect(container.firstChild).toHaveClass('absolute');
    expect(container.firstChild).not.toHaveClass('fixed');

    rerender(
      <FloatingActionPanel isVisible={true} onToggle={mockOnToggle} combatMode={false} anchored />,
    );
    expect(container.firstChild).toHaveClass('absolute');
    expect(container.firstChild).not.toHaveClass('fixed');

    rerender(<FloatingActionPanel isVisible={false} onToggle={mockOnToggle} combatMode={false} />);
    expect(container.firstChild).toHaveClass('fixed');
  });
});
