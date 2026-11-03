import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ show: true }));
vi.mock('@/config/legal', () => ({
  get SHOW_LEGAL_DRAFT_BANNER() {
    return flag.show;
  },
  LEGAL_LAST_UPDATED: 'test date',
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, userPlan: null, isBlogAdmin: false, signOut: vi.fn() }),
}));

import ContactPage from '../ContactPage';

const renderContact = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <ContactPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('legal draft banner flag and support email (#2258)', () => {
  afterEach(() => {
    flag.show = true;
    vi.unstubAllEnvs();
  });

  it('hides the banner when the single flag is off', () => {
    flag.show = false;
    renderContact();
    expect(screen.queryByTestId('legal-draft-banner')).toBeNull();
  });

  it('shows a mailto link from VITE_SUPPORT_EMAIL', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'help@example.test');
    renderContact();
    expect(screen.getByRole('link', { name: 'help@example.test' })).toHaveAttribute(
      'href',
      'mailto:help@example.test',
    );
  });

  it('#568: uses the app top bar instead of the launch wordmark and Sign in', () => {
    renderContact();
    const nav = document.getElementById('app-nav');
    expect(nav).not.toBeNull();
    expect(screen.getByRole('link', { name: /^home$/i })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('link', { name: 'Infinite Realms home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('says so when VITE_SUPPORT_EMAIL is unset', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    renderContact();
    expect(screen.getByText(/not configured yet/)).toBeInTheDocument();
  });
});
