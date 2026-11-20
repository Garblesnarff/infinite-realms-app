import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedAppRoutes } from '../ProtectedAppRoutes';

import type { ReactElement } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';

// #1671: a link must render its routed page with no reload. The real /app route
// table and chrome run; only the page bodies are stubbed with distinct text.

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

// Breadcrumbs need CampaignProvider; they are not part of the routing path under test.
vi.mock('@/shared/components/layout/breadcrumbs', () => ({ default: () => null }));

vi.mock('@/pages/AccountPage', () => ({ default: () => <h1>ACCOUNT PAGE</h1> }));
const CHARACTER_ID = '11111111-2222-4333-8444-555555555555';
const CAMPAIGN_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

// The roster and game pages render a router link where the real page navigates,
// so each click goes through the same router transition as the app.
vi.mock('@/features/character/components/list/character-list', async () => {
  const { Link } = await import('react-router-dom');
  return {
    default: (): ReactElement => (
      <>
        <h1>CHARACTER LIST PAGE</h1>
        <Link to={`/app/character/${CHARACTER_ID}`}>Aria Test roster card</Link>
      </>
    ),
  };
});
vi.mock('@/features/character/components/sheet/character-sheet', () => ({
  default: () => <h1>CHARACTER SHEET PAGE</h1>,
}));
vi.mock('@/pages/Index', () => ({ default: () => <h1>CAMPAIGN LIST PAGE</h1> }));
vi.mock('@/pages/campaigns/CampaignHubWithErrorBoundary', () => ({
  default: () => <h1>CAMPAIGN HUB PAGE</h1>,
}));
vi.mock('@/features/game-session/components/game/GameContentWithErrorBoundary', async () => {
  const { Link } = await import('react-router-dom');
  return {
    default: (): ReactElement => (
      <>
        <h1>GAME SCREEN PAGE</h1>
        <Link to="/app/account">Game to account</Link>
      </>
    ),
  };
});

function renderAppAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <HelmetProvider>
        <TooltipProvider delayDuration={0}>
          <Routes>
            <Route path="/app/*" element={<ProtectedAppRoutes />} />
          </Routes>
        </TooltipProvider>
      </HelmetProvider>
    </MemoryRouter>,
  );
}

describe('routed links render their page without a reload (#1671)', () => {
  beforeEach(() => {
    authState.value.user = { id: 'user-1', email: 'player@example.com' };
    authState.value.userPlan = 'free';
  });

  it('Account link swaps the page content', async () => {
    renderAppAt('/app');
    expect(await screen.findByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Account' }));

    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CAMPAIGN LIST PAGE')).not.toBeInTheDocument();
  });

  it('Characters link swaps the page content', async () => {
    renderAppAt('/app');
    expect(await screen.findByText('CAMPAIGN LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Characters/ }));

    await waitFor(() => expect(screen.getByText('CHARACTER LIST PAGE')).toBeInTheDocument());
    expect(screen.queryByText('CAMPAIGN LIST PAGE')).not.toBeInTheDocument();
  });

  it('Account then Characters then Account again each render their page', async () => {
    renderAppAt('/app/account');
    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /Characters/ }));
    expect(await screen.findByText('CHARACTER LIST PAGE')).toBeInTheDocument();
    expect(screen.queryByText('ACCOUNT PAGE')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Account' }));
    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CHARACTER LIST PAGE')).not.toBeInTheDocument();
  });
  it('a roster card opens the character sheet, then the list comes back on Characters', async () => {
    renderAppAt('/app/characters');
    expect(await screen.findByText('CHARACTER LIST PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Aria Test roster card' }));

    expect(await screen.findByText('CHARACTER SHEET PAGE')).toBeInTheDocument();
    expect(screen.queryByText('CHARACTER LIST PAGE')).not.toBeInTheDocument();
  });

  it('leaving the game screen for Account renders the Account page', async () => {
    renderAppAt(`/app/game/${CAMPAIGN_ID}`);
    expect(await screen.findByText('GAME SCREEN PAGE')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Game to account' }));

    expect(await screen.findByText('ACCOUNT PAGE')).toBeInTheDocument();
    expect(screen.queryByText('GAME SCREEN PAGE')).not.toBeInTheDocument();
  });
});
