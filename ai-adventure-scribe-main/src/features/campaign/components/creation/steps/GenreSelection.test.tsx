import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import GenreSelection from './GenreSelection';

// Mock CampaignContext
const mockDispatch = vi.fn();
const mockCampaignState = {
  campaign: {
    genre: '',
    name: 'Test Campaign', // Add other required fields if validation runs
    setting: {},
  },
};

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    state: mockCampaignState,
    dispatch: mockDispatch,
  }),
}));

// Mock child components that are not relevant to this test, if any (e.g. TooltipProvider if it causes issues)
// For now, assuming GenreSelection is simple enough not to need this.

describe('GenreSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset state before each test
    mockCampaignState.campaign = {
      genre: '',
      name: 'Test Campaign',
      setting: {},
    };
  });

  it('should render skeleton UI when isLoading is true', () => {
    const { container } = render(<GenreSelection isLoading={true} />);
    // Check for the title skeleton by its specific classes (h-8 w-48)
    // Using a more flexible selector that doesn't depend on margin classes
    const titleSkeleton = container.querySelector('.animate-pulse.h-8.w-48');
    expect(titleSkeleton).toBeInTheDocument();

    // Check for multiple card skeletons by common and specific classes
    const skeletonCards = container.querySelectorAll('.animate-pulse.h-12');
    expect(skeletonCards.length).toBeGreaterThanOrEqual(2);
  });

  it('should render genre options and reflect current selection', () => {
    mockCampaignState.campaign.genre = 'dark-fantasy';
    render(<GenreSelection isLoading={false} />);

    // Check a few genres are rendered by their accessible name (which includes description now)
    expect(screen.getByRole('radio', { name: /Traditional Fantasy/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Dark Fantasy/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Science Fantasy/ })).toBeInTheDocument();

    // Assert the correct radio item is checked
    const darkFantasyRadioItem = screen.getByRole('radio', { name: /Dark Fantasy/ });
    expect(darkFantasyRadioItem).toHaveAttribute('aria-checked', 'true');

    // Also, can verify other items are not checked
    const traditionalFantasyRadioItem = screen.getByRole('radio', { name: /Traditional Fantasy/ });
    expect(traditionalFantasyRadioItem).toHaveAttribute('aria-checked', 'false');
  });

  it('should call dispatch with updated genre when a new genre is selected', () => {
    render(<GenreSelection isLoading={false} />);

    // Find the radio for "Science Fantasy" and click it.
    const scienceFantasyRadio = screen.getByRole('radio', { name: /Science Fantasy/ });
    fireEvent.click(scienceFantasyRadio);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CAMPAIGN',
      payload: { genre: 'science-fantasy' },
    });
  });

  it('should highlight the selected genre card', () => {
    mockCampaignState.campaign.genre = 'steampunk';
    render(<GenreSelection isLoading={false} />);

    // The card itself is now the radio item
    const steampunkCard = screen.getByRole('radio', { name: /Steampunk/ });
    expect(steampunkCard).toHaveAttribute('aria-checked', 'true');
    expect(steampunkCard).toHaveClass('border-primary');

    // Verify another card is not highlighted
    const traditionalFantasyCard = screen.getByRole('radio', { name: /Traditional Fantasy/ });
    expect(traditionalFantasyCard).toHaveAttribute('aria-checked', 'false');
    expect(traditionalFantasyCard).not.toHaveClass('border-primary');
  });

  it('should have accessible view mode buttons', () => {
    render(<GenreSelection isLoading={false} />);

    const gridButton = screen.getByRole('button', { name: 'Grid view' });
    const listButton = screen.getByRole('button', { name: 'List view' });
    const compactButton = screen.getByRole('button', { name: 'Compact view' });

    expect(gridButton).toBeInTheDocument();
    expect(listButton).toBeInTheDocument();
    expect(compactButton).toBeInTheDocument();

    // Default view mode is compact in the code
    expect(compactButton).toHaveAttribute('aria-pressed', 'true');
    expect(gridButton).toHaveAttribute('aria-pressed', 'false');
    expect(listButton).toHaveAttribute('aria-pressed', 'false');

    // Check for title/tooltip
    expect(gridButton).toHaveAttribute('title', 'Grid view');
    expect(listButton).toHaveAttribute('title', 'List view');
    expect(compactButton).toHaveAttribute('title', 'Compact view');

    // Check for group role
    const group = screen.getByRole('group', { name: 'View mode' });
    expect(group).toBeInTheDocument();
  });
});
