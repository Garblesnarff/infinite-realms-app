import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PASSWORD_LOGIN_200_BODY,
  PASSWORD_LOGIN_REQUEST_BODY,
} from '../../../../../shared/test-fixtures/password-login-wire-body';
import TesterLoginPage from '../TesterLoginPage';

const { persistSession, toastSuccess } = vi.hoisted(() => ({
  persistSession: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess },
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    persistSession,
  }),
);

const LocationProbe = (): React.ReactElement => {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
};

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/auth/tester']}>
        <TesterLoginPage />
        <LocationProbe />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: PASSWORD_LOGIN_REQUEST_BODY.email },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: PASSWORD_LOGIN_REQUEST_BODY.password },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('TesterLoginPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_TESTER_LOGIN', 'true');
    fetchMock = vi.fn();
    global.fetch = Object.assign(fetchMock, { preconnect: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('posts exactly the fixture body and finishes sign-in through the shared helper', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PASSWORD_LOGIN_200_BODY }),
    });
    const tokensUpdated: Event[] = [];
    const onTokensUpdated = (event: Event) => {
      tokensUpdated.push(event);
    };
    window.addEventListener('auth-tokens-updated', onTokensUpdated);
    try {
      renderPage();
      await fillAndSubmit();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          'https://api.example.test/v1/auth/password-login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(PASSWORD_LOGIN_REQUEST_BODY),
            signal: expect.any(AbortSignal), // 15 s login ceiling (#565)
          },
        );
      });
      expect(persistSession).toHaveBeenCalledWith({
        access_token: PASSWORD_LOGIN_200_BODY.accessToken,
        refresh_token: PASSWORD_LOGIN_200_BODY.refreshToken,
      });
      expect(tokensUpdated).toHaveLength(1);
      // The shared helper waits for AuthContext: still on the page until
      // `auth-ready` fires.
      expect(screen.getByTestId('location')).toHaveTextContent('/auth/tester');

      window.dispatchEvent(
        new CustomEvent('auth-ready', {
          detail: { user: { email: PASSWORD_LOGIN_REQUEST_BODY.email } },
        }),
      );
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/app'));
      expect(toastSuccess).toHaveBeenCalledWith(
        `Signed in as ${PASSWORD_LOGIN_REQUEST_BODY.email}`,
      );
    } finally {
      window.removeEventListener('auth-tokens-updated', onTokensUpdated);
    }
  });

  it('navigates via the 5 s auth-ready fallback when the event never fires', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...PASSWORD_LOGIN_200_BODY }),
    });

    renderPage();
    await act(async () => {
      await fillAndSubmit();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(persistSession).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/app');
  });

  it('shows "Tester sign-in is not enabled" on a 404 and signs no one in', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not found' }),
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Tester sign-in is not enabled');
    expect(persistSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/auth/tester');
  });

  it('shows a generic error on a 401 without signing in', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid email or password' }),
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check your email and password and try again.',
    );
    expect(persistSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/auth/tester');
  });

  it('shows a generic error when the 200 carries no access token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ refreshToken: 'test-refresh-token' }),
    });

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check your email and password and try again.',
    );
    expect(persistSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/auth/tester');
  });

  it('shows a generic error when the request fails without signing in', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    renderPage();
    await fillAndSubmit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check your email and password and try again.',
    );
    expect(persistSession).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/auth/tester');
  });

  it('shows no form when VITE_TESTER_LOGIN is off', async () => {
    vi.stubEnv('VITE_TESTER_LOGIN', 'false');

    renderPage();

    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(screen.getByText('Tester sign-in is not enabled')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    // noindex on the flag-off branch too.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });

  it('emits noindex', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Tester sign-in' })).toBeInTheDocument();
    // react-helmet-async applies head changes on requestAnimationFrame.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex, nofollow',
    );
  });
});
