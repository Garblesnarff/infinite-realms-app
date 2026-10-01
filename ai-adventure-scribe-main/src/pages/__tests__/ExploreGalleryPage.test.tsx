import { render, screen } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import ExploreGalleryPage from '../ExploreGalleryPage';

const state = vi.hoisted(() => ({
  campaigns: [] as never[],
  isLoading: true,
  error: null,
}));

vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => state,
}));
vi.mock('@/components/campaigns/StarterCampaignCard', () => ({
  StarterCampaignCard: () => <div data-testid="campaign-card" />,
}));

describe('ExploreGalleryPage (#2343 item 16)', () => {
  it('shows loading before revealing empty-state copy after an empty fetch', () => {
    const { rerender } = render(
      <HelmetProvider>
        <MemoryRouter>
          <ExploreGalleryPage />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading campaigns' })).toBeInTheDocument();
    expect(screen.queryByText('More Adventures Coming Soon')).not.toBeInTheDocument();

    state.isLoading = false;
    rerender(
      <HelmetProvider>
        <MemoryRouter>
          <ExploreGalleryPage />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByText('More Adventures Coming Soon')).toBeInTheDocument();
    expect(screen.getByText('No campaigns available yet. Check back soon!')).toBeInTheDocument();
  });
});
