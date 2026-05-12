/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StatsBar } from '../StatsBar';

import { useCharacter } from '@/contexts/CharacterContext';

// Mock the CharacterContext
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

describe('StatsBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getStatValue = (label: string): string | null | undefined => {
    const statBadge = screen.getByText(label).parentElement;
    // Use standard DOM query on the element.
    return statBadge?.querySelector('span')?.textContent;
  };

  it('renders nothing when no character is provided', () => {
    (useCharacter as any).mockReturnValue({
      state: { character: null },
    });

    const { container } = render(<StatsBar />);
    expect(container.firstChild).toBeNull();
  });

  it('calculates and displays standard stats for a level 1 Fighter', () => {
    const mockCharacter = {
      level: 1,
      class: { name: 'Fighter', hitDie: 10 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: 3 },
        constitution: { modifier: 2 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 0 },
        charisma: { modifier: 0 },
      },
      equippedArmor: '',
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    // HP: 10 + 2 = 12
    expect(getStatValue('HP')).toBe('12');

    // AC: 10 + 3 = 13
    expect(getStatValue('AC')).toBe('13');

    // PROF: +2
    expect(getStatValue('PROF')).toBe('+2');

    // INIT: +3
    expect(getStatValue('INIT')).toBe('+3');
  });

  it('displays negative initiative correctly', () => {
    const mockCharacter = {
      level: 1,
      class: { name: 'Fighter', hitDie: 10 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: -1 },
        constitution: { modifier: 2 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 0 },
        charisma: { modifier: 0 },
      },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    expect(getStatValue('INIT')).toBe('-1');
  });

  it('calculates Barbarian Unarmored Defense correctly', () => {
    const mockCharacter = {
      level: 1,
      class: { name: 'Barbarian', hitDie: 12 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: 2 },
        constitution: { modifier: 3 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 0 },
        charisma: { modifier: 0 },
      },
      equippedArmor: '',
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    // HP: 12 + 3 = 15
    expect(getStatValue('HP')).toBe('15');
    // AC: 10 + 2 (DEX) + 3 (CON) = 15
    expect(getStatValue('AC')).toBe('15');
  });

  it('calculates Monk Unarmored Defense correctly', () => {
    const mockCharacter = {
      level: 1,
      class: { name: 'Monk', hitDie: 8 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: 4 },
        constitution: { modifier: 1 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 3 },
        charisma: { modifier: 0 },
      },
      equippedArmor: '',
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    // AC: 10 + 4 (DEX) + 3 (WIS) = 17
    expect(getStatValue('AC')).toBe('17');
  });

  it('verifies fixed HP calculation for level 2', () => {
    // Standard 5e (and calculateAllCharacterStats): (10 + 2) + (6 + 2) = 20
    const mockCharacter = {
      level: 2,
      class: { name: 'Fighter', hitDie: 10 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: 0 },
        constitution: { modifier: 2 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 0 },
        charisma: { modifier: 0 },
      },
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    expect(getStatValue('HP')).toBe('20');
  });

  it('verifies fixed AC calculation with shield', () => {
    const mockCharacter = {
      level: 1,
      class: { name: 'Fighter', hitDie: 10 },
      abilityScores: {
        strength: { modifier: 0 },
        dexterity: { modifier: 2 },
        constitution: { modifier: 0 },
        intelligence: { modifier: 0 },
        wisdom: { modifier: 0 },
        charisma: { modifier: 0 },
      },
      equippedArmor: '',
      equippedShield: 'Shield', // This should add +2
    };

    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<StatsBar />);

    // Expected AC: 10 + 2 + 2 = 14.
    expect(getStatValue('AC')).toBe('14');
  });
});
