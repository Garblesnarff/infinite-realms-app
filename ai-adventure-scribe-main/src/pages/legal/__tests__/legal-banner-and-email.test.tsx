import { render, screen } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { afterEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ show: true }));
vi.mock('@/config/legal', () => ({
  get SHOW_LEGAL_DRAFT_BANNER() {
    return flag.show;
  },
  LEGAL_LAST_UPDATED: 'test date',
}));

import ContactPage from '../ContactPage';

const renderContact = () =>
  render(
    <HelmetProvider>
      <ContactPage />
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

  it('says so when VITE_SUPPORT_EMAIL is unset', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', '');
    renderContact();
    expect(screen.getByText(/not configured yet/)).toBeInTheDocument();
  });
});
