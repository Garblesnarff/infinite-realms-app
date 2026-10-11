import { render, screen } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes, useLocation, useRoutes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { getAppRoutes } from '../app-routes';

import { AppRoutes } from '@/App';
import Breadcrumbs from '@/shared/components/layout/breadcrumbs';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/hooks/use-entity-label', () => ({
  useEntityLabel: () => ({ label: null, loading: false }),
}));

const stub = (label: string) => ({
  default: () => <div>{label}</div>,
});

vi.mock('@/pages/Index', () => stub('campaign list'));
vi.mock('@/features/character/components/sheet/character-sheet', () => stub('character sheet'));
vi.mock('@/features/character/components/list/character-list', () => stub('character list'));
vi.mock('@/features/campaign/components/creation/campaign-wizard', () => stub('wizard'));
vi.mock('@/features/game-session/components/game/GameContentWithErrorBoundary', () => stub('game'));
vi.mock('@/pages/CharacterCreateEntry', () => stub('create character'));
vi.mock('@/pages/campaigns/CampaignHubWithErrorBoundary', () => stub('campaign hub'));
vi.mock('@/pages/BlogAdmin', () => stub('blog'));
vi.mock('@/pages/BlogEditor', () => stub('blog editor'));
vi.mock('@/pages/AccountPage', () => stub('account'));
vi.mock('@/pages/LaunchPage', () => stub('launch'));
vi.mock('@/pages/ExploreGalleryPage', () => stub('explore'));
vi.mock('@/features/auth/components/CallbackPage', () => stub('callback'));

const LocationProbe = (): React.ReactElement => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

const AppTable = (): React.ReactElement | null => useRoutes(getAppRoutes());

function renderApp(path: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[path]}>
        <Breadcrumbs />
        <Routes>
          <Route path="/app/*" element={<AppTable />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('unknown URLs (#2706)', () => {
  it.each(['/app/campaigns/x/scenes/y', '/app/campaigns/x/scenes'])(
    'shows AppNotFound for the retired scene URL %s (#199 step 3)',
    (path) => {
      renderApp(path);

      expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to your campaigns' })).toHaveAttribute(
        'href',
        '/app',
      );
      expect(screen.getByTestId('location')).toHaveTextContent(path);
      expect(screen.queryByText('campaign hub')).not.toBeInTheDocument();
    },
  );

  it('renders a public 404 with a link home', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/nonsense']}>
          <AppRoutes />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
  });

  it('emits noindex on the public 404 page (#227 AU-04)', async () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/nonsense']}>
          <AppRoutes />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    // react-helmet-async applies head changes on requestAnimationFrame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('redirects an unknown campaign tab to the overview', async () => {
    renderApp('/app/campaigns/123/nonsense');

    expect(await screen.findByText('campaign hub')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/campaigns/123');
    expect(screen.queryByRole('link', { name: 'Nonsense' })).not.toBeInTheDocument();
  });

  it('keeps a real campaign tab in the URL', async () => {
    renderApp('/app/campaigns/123/characters');

    expect(await screen.findByText('campaign hub')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/campaigns/123/characters');
  });

  it('redirects /app/campaigns/new to /app', async () => {
    renderApp('/app/campaigns/new');

    expect(await screen.findByText('campaign list')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app$/);
  });

  it('links the character crumb to /app/characters as Characters', async () => {
    renderApp('/app/character/abc');

    expect(await screen.findByText('character sheet')).toBeInTheDocument();
    const characters = screen.getByRole('link', { name: 'Characters' });
    expect(characters).toHaveAttribute('href', '/app/characters');
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).not.toContain('/app/character');
  });

  it('shows Home › Characters on /app/characters', async () => {
    renderApp('/app/characters');

    expect(await screen.findByText('character list')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'Characters' })).toHaveAttribute(
      'href',
      '/app/characters',
    );
  });

  it.each([
    ['/', 'launch'],
    ['/explore', 'explore'],
    ['/auth/callback', 'callback'],
  ])('keeps the real public route %s ahead of the catch-all', async (path, label) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });

  it('renders the /app fallback link', async () => {
    renderApp('/app/no-such-page');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your campaigns' })).toHaveAttribute(
      'href',
      '/app',
    );
  });

  it('keeps the query string when an unknown tab redirects', async () => {
    renderApp('/app/campaigns/123/nonsense?startSession=true');

    expect(await screen.findByText('campaign hub')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/app/campaigns/123?startSession=true',
    );
  });
});
