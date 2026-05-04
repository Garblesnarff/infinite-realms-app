import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import CharacterSelectionModal from '../character-selection-modal';

// Mock hooks
vi.mock('@/features/campaign/hooks/use-character-selection', () => ({
  useCharacterSelection: vi.fn(() => ({
    isLoading: false,
    isCreating: false,
    isStarterCampaign: true,
    templates: [
      {
        id: 'temp-1',
        name: 'Aragorn',
        race: 'Human',
        class: 'Ranger',
        level: 5,
        ability_scores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 12, wisdom: 14, charisma: 14 },
      },
    ],
    characters: [],
    handleSelectTemplate: vi.fn(),
    startGameWithCharacter: vi.fn(),
    handleCreateCharacter: vi.fn(),
    getModifier: vi.fn((val) => `+${Math.floor((val - 10) / 2)}`),
  })),
}));

describe('CharacterSelectionModal Accessibility', () => {
  it('renders starter templates as accessible buttons', () => {
    const handleClose = vi.fn();
    render(
      <CharacterSelectionModal
        isOpen={true}
        onClose={handleClose}
        campaignId="camp-1"
        campaignName="The Ring Quest"
      />
    );

    const card = screen.getByRole('button', { name: /Select character: Aragorn/i });
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute('tabIndex', '0');
    expect(card).toHaveAttribute('title', expect.stringContaining('Aragorn'));
  });

  it('provides descriptive labels for ability modifiers', () => {
    render(
      <CharacterSelectionModal
        isOpen={true}
        onClose={vi.fn()}
        campaignId="camp-1"
        campaignName="The Ring Quest"
      />
    );

    const strModifier = screen.getByLabelText(/Strength modifier: \+3/i);
    expect(strModifier).toBeInTheDocument();

    // Check that it's hidden from SR in the children to avoid double announcement
    const strLabel = screen.getByText('STR');
    expect(strLabel).toHaveAttribute('aria-hidden', 'true');
  });

  it('marks decorative images and buttons as hidden', () => {
    render(
      <CharacterSelectionModal
        isOpen={true}
        onClose={vi.fn()}
        campaignId="camp-1"
        campaignName="The Ring Quest"
      />
    );

    // The inner "Start Adventure" button should be hidden as the card itself is the trigger
    const startButton = screen.getByText(/Start Adventure/i).closest('button');
    expect(startButton).toHaveAttribute('aria-hidden', 'true');
    expect(startButton).toHaveAttribute('tabIndex', '-1');
  });
});
