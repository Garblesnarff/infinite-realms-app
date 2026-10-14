import { render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the auth state is stubbed; Navigation, LaunchHeader and TermsPage are real.
const auth = vi.hoisted(() => ({
  user: null as null | { id: string; email: string },
  userPlan: 'free' as string | null,
  loading: false,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: auth.user,
    userPlan: auth.userPlan,
    loading: auth.loading,
    isBlogAdmin: false,
    signOut: vi.fn(),
  }),
}));

import TermsPage from '../TermsPage';

import { TooltipProvider } from '@/components/ui/tooltip';

const renderTerms = () =>
  render(
    <HelmetProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={['/terms']}>
          <TermsPage />
        </MemoryRouter>
      </TooltipProvider>
    </HelmetProvider>,
  );

describe('legal pages top bar (#568)', () => {
  beforeEach(() => {
    auth.user = null;
    auth.userPlan = 'free';
    auth.loading = false;
  });

  it('signed-in players get the app navigation so they can leave the page', () => {
    auth.user = { id: 'player-1', email: 'player@example.test' };
    renderTerms();

    const appNav = document.getElementById('app-nav');
    expect(appNav).not.toBeNull();
    const nav = within(appNav as HTMLElement);
    expect(nav.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/app');
    expect(nav.getByRole('link', { name: /characters/i })).toHaveAttribute(
      'href',
      '/app/characters',
    );
    expect(nav.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/app/account');
    expect(nav.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('signed-out visitors keep the launch header with Sign in and no app navigation', () => {
    renderTerms();

    expect(document.getElementById('app-nav')).toBeNull();
    expect(screen.getByRole('link', { name: 'Infinite Realms home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/app');
  });

  it('shows neither header while auth is loading, so a signed-in visitor never sees Sign in first', () => {
    auth.loading = true;
    renderTerms();

    expect(document.getElementById('app-nav')).toBeNull();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
