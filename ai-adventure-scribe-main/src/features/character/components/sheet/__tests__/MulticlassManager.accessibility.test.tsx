import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import MulticlassManager from '../MulticlassManager';

import type { Character, CharacterClass } from '@/types/character';

// Mock useMulticlassing hook
vi.mock('@/hooks/use-multiclassing', () => ({
  useMulticlassing: vi.fn((character, onUpdate) => ({
    isProcessing: false,
    validationResult: null,
    validateNewClass: vi.fn(),
    addNewClass: vi.fn(),
    levelUpSpecificClass: vi.fn(),
    getProficiencies: () => ({ armor: [], weapons: [], tools: [], savingThrows: [] }),
    getHitPoints: () => 10,
    getSpellcasting: () => ({ combinedCasterLevel: 1, spellcastingClasses: [], spellSlots: [] }),
    isMulticlassed: () => character.classLevels && character.classLevels.length > 1,
    getTotalLevel: () => 1,
  })),
}));

// Mock data/levelProgression
vi.mock('@/data/levelProgression', () => ({
  getProficiencyBonus: vi.fn(() => 2),
  getAllClassFeaturesUpToLevel: vi.fn(() => []),
  getMulticlassProficiencies: vi.fn(() => ({})),
}));

describe('MulticlassManager Accessibility', () => {
  const mockCharacter = {
    id: 'char-123',
    name: 'Test Character',
    level: 1,
    class: { id: 'fighter', name: 'Fighter', hitDie: 10 },
  } as Character;

  const mockOnUpdate = vi.fn();

  it('should have role="button" and aria-expanded on class expansion headers', () => {
    const multiclassCharacter = {
      ...mockCharacter,
      classLevels: [
        { classId: 'fighter', className: 'Fighter', level: 1, hitDie: 10 }
      ]
    } as Character;

    render(<MulticlassManager character={multiclassCharacter} onUpdate={mockOnUpdate} />);

    const expansionHeader = screen.getByRole('button', { name: /Expand Fighter details/i });
    expect(expansionHeader).toBeInTheDocument();
    expect(expansionHeader).toHaveAttribute('aria-expanded', 'false');
    expect(expansionHeader).toHaveAttribute('tabIndex', '0');
  });

  it('should have role="button" on Add New Class selection items', () => {
    const availableClasses = [
      { id: 'wizard', name: 'Wizard', hitDie: 6 }
    ] as CharacterClass[];

    render(<MulticlassManager character={mockCharacter} onUpdate={mockOnUpdate} availableClasses={availableClasses} />);

    const addClassButton = screen.getByRole('button', { name: /Add class: Wizard/i });
    expect(addClassButton).toBeInTheDocument();
    expect(addClassButton).toHaveAttribute('tabIndex', '0');
  });

  it('should have aria-label on level-up button', () => {
    const multiclassCharacter = {
      ...mockCharacter,
      classLevels: [
        { classId: 'fighter', className: 'Fighter', level: 1, hitDie: 10 }
      ]
    } as Character;

    render(<MulticlassManager character={multiclassCharacter} onUpdate={mockOnUpdate} />);

    const levelUpButton = screen.getByRole('button', { name: /Level up Fighter/i });
    expect(levelUpButton).toBeInTheDocument();
  });
});
