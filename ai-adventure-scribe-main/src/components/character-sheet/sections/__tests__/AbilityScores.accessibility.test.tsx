import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import AbilityScores from '../AbilityScores';

import { supabase } from '@/integrations/supabase/client';

// Mock the hooks and services
const mockToast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: mockToast,
  })),
}));

let mockUpdateSuccess = true;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          get error() {
            return mockUpdateSuccess ? null : new Error('Database error');
          },
        })),
      })),
    })),
  },
}));

describe('AbilityScores Accessibility and Logic', () => {
  const mockStats = {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };

  const mockOnStatsUpdate = vi.fn();

  it('renders ability scores with correctly linked labels and inputs', () => {
    render(
      <AbilityScores
        characterId="test-id"
        stats={mockStats}
        onStatsUpdate={mockOnStatsUpdate}
      />
    );

    const abilities = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

    abilities.forEach((ability) => {
      // Find the label
      const label = screen.getByText(new RegExp(ability, 'i'));
      expect(label).toBeInTheDocument();

      // Find the input associated with the label
      const input = screen.getByLabelText(new RegExp(ability, 'i'));
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('id');
      expect(label).toHaveAttribute('for', input.getAttribute('id'));
    });
  });

  it('save button has descriptive aria-label and title', () => {
    render(
      <AbilityScores
        characterId="test-id"
        stats={mockStats}
        onStatsUpdate={mockOnStatsUpdate}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save ability scores/i });
    expect(saveButton).toBeInTheDocument();
    expect(saveButton).toHaveAttribute('title', 'Save ability scores');
  });

  it('updates stats and calls supabase on save', async () => {
    mockUpdateSuccess = true;
    render(
      <AbilityScores
        characterId="test-id"
        stats={mockStats}
        onStatsUpdate={mockOnStatsUpdate}
      />
    );

    const strengthInput = screen.getByLabelText(/strength/i);
    fireEvent.change(strengthInput, { target: { value: '15' } });

    const saveButton = screen.getByRole('button', { name: /save ability scores/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('character_stats');
      expect(mockOnStatsUpdate).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Success'
      }));
    });
  });

  it('handles database error during save', async () => {
    mockUpdateSuccess = false;
    render(
      <AbilityScores
        characterId="test-id"
        stats={mockStats}
        onStatsUpdate={mockOnStatsUpdate}
      />
    );

    const saveButton = screen.getByRole('button', { name: /save ability scores/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Error',
        description: 'Failed to update ability scores'
      }));
    });
  });

  it('validates stats before saving', async () => {
    render(
      <AbilityScores
        characterId="test-id"
        stats={mockStats}
        onStatsUpdate={mockOnStatsUpdate}
      />
    );

    const strengthInput = screen.getByLabelText(/strength/i);
    fireEvent.change(strengthInput, { target: { value: '2' } }); // Invalid < 3

    const saveButton = screen.getByRole('button', { name: /save ability scores/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Invalid Ability Scores'
      }));
    });
  });
});
