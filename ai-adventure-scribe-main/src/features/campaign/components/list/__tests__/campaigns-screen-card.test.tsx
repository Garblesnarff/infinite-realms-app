import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import CampaignList from '../campaign-list';

/**
 * #1610: the public Explore page uses the board card. The in-app Campaigns screen keeps its own
 * card and must not pick up the public one. The boxed parchment card (BoxedCampaign, #1484) is
 * still rendered by its table-start screens, which table-start.test.tsx pins.
 */
vi.mock('../../../hooks/use-campaigns-list', () => ({
  useCampaignsList: () => ({
    data: [{ id: 'c1', name: 'Campaign One', created_at: '2026-01-01T00:00:00Z' }],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock('../campaign-card', () => ({
  MemoizedCampaignCard: ({ campaign }: { campaign: { name: string } }) => (
    <div data-testid="in-app-campaign-card">{campaign.name}</div>
  ),
}));

describe('in-app Campaigns screen card (#1610)', () => {
  it('renders the in-app campaign card, not the public Explore card', () => {
    render(
      <MemoryRouter>
        <CampaignList />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('in-app-campaign-card')).toHaveTextContent('Campaign One');
    expect(screen.queryByText('Begin your journey')).not.toBeInTheDocument();
    expect(screen.queryByText('Open the box')).not.toBeInTheDocument();
  });
});
