import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExploreGalleryPage from '../ExploreGalleryPage';

const state = vi.hoisted(() => ({
  campaigns: [] as never[],
  isLoading: true,
  error: null,
}));

vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => state,
}));
// The Table look is the only campaign card now (the boxed card); StarterCampaignCard is unreachable here.
vi.mock('@/features/campaigns/table/BoxedCampaign', () => ({
  BoxedCampaign: () => <div data-testid="campaign-card" />,
}));

describe('ExploreGalleryPage (#2343 item 16)', () => {
  beforeEach(() => {
    // Table look on, as the public pages now run it (the boxed card path).
    document.body.classList.add('ir-table-look');
  });
  afterEach(() => {
    document.body.classList.remove('ir-table-look');
  });

  it('shows loading before revealing empty-state copy after an empty fetch', () => {
    const { rerender } = render(
      <HelmetProvider>
        <MemoryRouter>
          <ExploreGalleryPage />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByRole('status', { name: 'Loading campaigns' })).toBeInTheDocument();
    // Sighted users see the text too (#2436): it is not the screen-reader-only kind.
    const visibleText = screen.getByText('Loading campaigns…');
    expect(visibleText).toBeVisible();
    expect(visibleText).not.toHaveClass('sr-only');
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

  it('uses the same three-column grid while loading and when loaded (#2259)', () => {
    const renderPage = (): ReturnType<typeof render> =>
      render(
        <HelmetProvider>
          <MemoryRouter>
            <ExploreGalleryPage />
          </MemoryRouter>
        </HelmetProvider>,
      );

    state.isLoading = true;
    const loading = renderPage();
    expect(
      screen.getByRole('status', { name: 'Loading campaigns' }).querySelector('.grid'),
    ).toHaveClass('grid-cols-1', 'lg:grid-cols-3');
    loading.unmount();

    state.isLoading = false;
    state.campaigns = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never[];
    renderPage();
    expect(screen.getAllByTestId('campaign-card')).toHaveLength(3);
    expect(screen.getAllByTestId('campaign-card')[0].parentElement).toHaveClass(
      'grid-cols-1',
      'lg:grid-cols-3',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Explore adventures' }),
    ).toBeInTheDocument();
  });

  it('shows the error banner with a Try again button (#2259)', () => {
    state.isLoading = false;
    state.campaigns = [];
    state.error = new Error('boom') as never;
    render(
      <HelmetProvider>
        <MemoryRouter>
          <ExploreGalleryPage />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByText('We could not load the campaigns.')).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    state.error = null;
  });
});
