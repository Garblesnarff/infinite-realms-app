import { render, screen, within } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the auth state is stubbed. Navigation, TermsPage, and PrivacyPage are real.
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

import PrivacyPage from '../PrivacyPage';
import TermsPage from '../TermsPage';

import { TooltipProvider } from '@/components/ui/tooltip';

const renderPage = (path: '/terms' | '/privacy'): ReturnType<typeof render> =>
  render(
    <HelmetProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          {path === '/terms' ? <TermsPage /> : <PrivacyPage />}
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

  it.each(['/terms', '/privacy'] as const)(
    '%s shows the app top bar when signed in, including Account',
    (path) => {
      auth.user = { id: 'player-1', email: 'player@example.test' };
      renderPage(path);

      const nav = within(document.getElementById('app-nav') as HTMLElement);
      expect(nav.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/app');
      expect(nav.getByRole('link', { name: /characters/i })).toHaveAttribute(
        'href',
        '/app/characters',
      );
      expect(nav.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/app/account');
      expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Draft — under review');
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    },
  );

  it.each(['/terms', '/privacy'] as const)(
    '%s shows the app top bar when signed out, without Account',
    (path) => {
      renderPage(path);

      const nav = within(document.getElementById('app-nav') as HTMLElement);
      expect(nav.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/app');
      expect(nav.getByRole('link', { name: /characters/i })).toHaveAttribute(
        'href',
        '/app/characters',
      );
      expect(nav.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
      expect(nav.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
      expect(screen.getByTestId('legal-draft-banner')).toHaveTextContent('Draft — under review');
    },
  );
});
