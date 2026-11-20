import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedAppRoutes } from '../ProtectedAppRoutes';
import { RoutePendingIndicator } from '../RoutePendingIndicator';

import { TooltipProvider } from '@/components/ui/tooltip';

// #1671 (second card): a page whose chunk has not loaded yet. The Account page module
// resolves only when the test opens its gate, so the lazy import stays pending.

const gates = vi.hoisted(() => {
  let openAccount!: () => void;
  let openCharacters!: () => void;
  const account = new Promise<void>((resolve) => {
    openAccount = resolve;
  });
  const characters = new Promise<void>((resolve) => {
    openCharacters = resolve;
  });
  // Never opened: this chunk stalls for the whole test.
  const campaignHub = new Promise<void>(() => {});
  return {
    account,
    characters,
    campaignHub,
    openAccount: () => openAccount(),
    openCharacters: () => openCharacters(),
  };
});

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 'user-1', email: 'player@example.com' } as { id: string; email: string } | null,
    userPlan: 'free' as string | null,
    isBlogAdmin: false,
    loading: false,
    sessionEnded: false,
    connectionError: false,
    refreshAuth: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

vi.mock('@/shared/components/layout/breadcrumbs', () => ({ default: () => null }));

vi.mock('@/pages/AccountPage', async () => {
  await gates.account;
  return { default: () => <h1>ACCOUNT PAGE</h1> };
});
vi.mock('@/features/character/components/list/character-list', async () => {
  await gates.characters;
  return { default: () => <h1>CHARACTER LIST PAGE</h1> };
});
vi.mock('@/features/character/components/sheet/character-sheet', () => ({
  default: () => <h1>CHARACTER SHEET PAGE</h1>,
}));
vi.mock('@/pages/Index', async () => {
  const { Link } = await import('react-router-dom');
  return {
    default: () => (
      <>
        <h1>CAMPAIGN LIST PAGE</h1>
        <Link to="/app/account">Open account</Link>
        <Link to="/app/characters">Open characters</Link>
        <Link to="/app/campaigns/camp-1">Open campaign</Link>
      </>
    ),
  };
});
vi.mock('@/pages/campaigns/CampaignHubWithErrorBoundary', async () => {
  await gates.campaignHub;
  return { default: () => <h1>CAMPAIGN HUB PAGE</h1> };
});
vi.mock('@/features/game-session/components/game/GameContentWithErrorBoundary', () => ({
  default: () => <h1>GAME SCREEN PAGE</h1>,
}));

function renderAppAt(path: string): ReturnType<typeof render> {
  // BrowserRouter, as in App.tsx: the browser URL is written at once, the router state waits.
  window.history.replaceState({}, '', path);
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HelmetProvider>
        <TooltipProvider delayDuration={0}>
          <RoutePendingIndicator />
          <Routes>
            <Route path="/app/*" element={<ProtectedAppRoutes />} />
          </Routes>
        </TooltipProvider>
      </HelmetProvider>
    </BrowserRouter>,
  );
}

describe('a page whose chunk is still loading (#1671)', () => {
  beforeEach(() => {
    authState.value.user = { id: 'user-1', email: 'player@example.com' };
    window.history.replaceState({}, '', '/');
  });

  it('keeps the old page while the URL has moved on, then swaps when the chunk arrives', async () => {
    renderAppAt('/app');
    expect(await screen.findByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Open account' }));

    // The URL has changed, the Account chunk has not loaded, and the old page is still shown.
    expect(window.location.pathname).toBe('/app/account');
    expect(screen.getByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();
    expect(screen.queryByText('ACCOUNT PAGE')).not.toBeInTheDocument();

    gates.openAccount();

    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CAMPAIGN LIST PAGE')).not.toBeInTheDocument();
  });
  it('shows a progress bar after 300 ms while the page chunk loads, then clears it', async () => {
    renderAppAt('/app');
    expect(await screen.findByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Open characters' }));

    expect(await screen.findByRole('progressbar', { name: 'Loading page' })).toBeInTheDocument();
    expect(screen.getByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    gates.openCharacters();

    expect(await screen.findByText('CHARACTER LIST PAGE')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('progressbar', { name: 'Loading page' })).not.toBeInTheDocument(),
    );
  });

  it('shows the error card with a Reload button when the chunk never arrives', async () => {
    renderAppAt('/app');
    expect(await screen.findByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Open campaign' }));

    const alert = await screen.findByRole('alert', {}, { timeout: 20_000 });
    expect(alert).toHaveTextContent('This page did not load');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('CAMPAIGN HUB PAGE')).not.toBeInTheDocument();
  }, 25_000);
});
