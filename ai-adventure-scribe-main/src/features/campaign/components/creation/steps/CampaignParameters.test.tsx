import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import CampaignParameters from './CampaignParameters';

// Mock CampaignContext
const mockDispatch = vi.fn();
const mockCampaignState = {
  campaign: {
    difficulty_level: '',
    campaign_length: '',
    tone: '',
  },
};

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    state: mockCampaignState,
    dispatch: mockDispatch,
  }),
}));

describe('CampaignParameters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCampaignState.campaign = {
      difficulty_level: '',
      campaign_length: '',
      tone: '',
    };
  });

  it('should render all three parameter sections', () => {
    render(<CampaignParameters isLoading={false} />);

    expect(screen.getByText('Difficulty Level')).toBeInTheDocument();
    expect(screen.getByText('Campaign Length')).toBeInTheDocument();
    expect(screen.getByText('Campaign Tone')).toBeInTheDocument();
  });

  it('should render options and reflect current selection', () => {
    mockCampaignState.campaign.difficulty_level = 'medium';
    mockCampaignState.campaign.campaign_length = 'short';
    mockCampaignState.campaign.tone = 'humorous';

    render(<CampaignParameters isLoading={false} />);

    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Short Campaign' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Humorous' })).toBeChecked();
  });

  it('should call dispatch when a new option is selected', () => {
    render(<CampaignParameters isLoading={false} />);

    fireEvent.click(screen.getByLabelText('Hard'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CAMPAIGN',
      payload: { difficulty_level: 'hard' },
    });

    fireEvent.click(screen.getByLabelText('Full Campaign'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CAMPAIGN',
      payload: { campaign_length: 'full' },
    });

    fireEvent.click(screen.getByLabelText('Gritty'));
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CAMPAIGN',
      payload: { tone: 'gritty' },
    });
  });

  it('should filter options based on search query', () => {
    render(<CampaignParameters isLoading={false} />);

    const searchInput = screen.getByPlaceholderText(/search difficulty/i);
    fireEvent.change(searchInput, { target: { value: 'easy' } });

    expect(screen.getByText('Easy')).toBeInTheDocument();
    expect(screen.queryByText('Medium')).not.toBeInTheDocument();
    expect(screen.queryByText('Hard')).not.toBeInTheDocument();
  });

  it('should change view mode', () => {
    render(<CampaignParameters isLoading={false} />);

    const listViewButton = screen.getByRole('button', { name: 'List view' });
    fireEvent.click(listViewButton);
    expect(listViewButton).toHaveAttribute('aria-pressed', 'true');

    const gridViewButton = screen.getByRole('button', { name: 'Grid view' });
    fireEvent.click(gridViewButton);
    expect(gridViewButton).toHaveAttribute('aria-pressed', 'true');
  });
});
