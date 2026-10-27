import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { authLoginUrl } from '../auth-login-url';
import AuthPage from '../AuthPage';

describe('AuthPage', () => {
  it('presents a branded return path before handing authentication to WorkOS', () => {
    render(
      <MemoryRouter initialEntries={['/app']}>
        <AuthPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /your worlds are waiting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in or create an account/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /back to landing/i })).toHaveAttribute('href', '/');
  });

  it('returns to the page that reported the ended session', () => {
    expect(authLoginUrl('https://api.example.test', '/app?tab=combat#turn-3')).toBe(
      'https://api.example.test/v1/auth/login?returnTo=%2Fapp%3Ftab%3Dcombat%23turn-3',
    );

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, href: '' },
    });
    try {
      render(
        <MemoryRouter initialEntries={['/app?tab=combat#turn-3']}>
          <AuthPage />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole('button', { name: /sign in or create an account/i }));
      expect(window.location.href).toContain(
        '/v1/auth/login?returnTo=%2Fapp%3Ftab%3Dcombat%23turn-3',
      );
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});
