import { render, screen } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect } from 'vitest';

import { usePersonalitySelection } from '../personality/use-personality-selection';
import PersonalitySelection from '../PersonalitySelection';

// Mock the hook
vi.mock('../personality/use-personality-selection', () => ({
  usePersonalitySelection: vi.fn(),
}));

const mockUsePersonalitySelection = vi.mocked(usePersonalitySelection);

describe('PersonalitySelection Accessibility', () => {
  it('should associate Ideal, Bond, and Flaw labels with their respective textareas', () => {
    mockUsePersonalitySelection.mockReturnValue({
      state: {
        character: {
          personalityTraits: ['Trait 1 content', 'Trait 2 content'],
          ideals: ['Ideal content'],
          bonds: ['Bond content'],
          flaws: ['Flaw content'],
        },
      },
      selectedBackground: null,
      handlePersonalityTraitsChange: vi.fn(),
      handleIdealChange: vi.fn(),
      handleBondChange: vi.fn(),
      handleFlawChange: vi.fn(),
      handleRandomize: vi.fn(),
      handleRandomizeAll: vi.fn(),
    });

    render(<PersonalitySelection />);

    // Check that textareas are linked to their labels
    const idealInput = screen.getByRole('textbox', { name: /ideal/i });
    expect(idealInput).toBeInTheDocument();
    expect(idealInput).toHaveValue('Ideal content');

    const bondInput = screen.getByRole('textbox', { name: /bond/i });
    expect(bondInput).toBeInTheDocument();
    expect(bondInput).toHaveValue('Bond content');

    const flawInput = screen.getByRole('textbox', { name: /flaw/i });
    expect(flawInput).toBeInTheDocument();
    expect(flawInput).toHaveValue('Flaw content');
  });

  it('should have descriptive aria-labels on randomize buttons', () => {
    mockUsePersonalitySelection.mockReturnValue({
      state: {
        character: {
          personalityTraits: ['', ''],
          ideals: [''],
          bonds: [''],
          flaws: [''],
        },
      },
      selectedBackground: null,
      handlePersonalityTraitsChange: vi.fn(),
      handleIdealChange: vi.fn(),
      handleBondChange: vi.fn(),
      handleFlawChange: vi.fn(),
      handleRandomize: vi.fn(),
      handleRandomizeAll: vi.fn(),
    });

    render(<PersonalitySelection />);

    expect(screen.getByRole('button', { name: /randomize trait 1/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /randomize trait 2/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /randomize ideal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /randomize bond/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /randomize flaw/i })).toBeInTheDocument();
  });
});
