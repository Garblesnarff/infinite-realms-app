import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CallbackPage from '../CallbackPage';

const { navigate, persistSession, toastSuccess } = vi.hoisted(() => ({
  navigate: vi.fn(),
  persistSession: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  persistSession,
}));

describe('CallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/auth/callback');
    global.fetch = vi.fn();
  });

  it('exchanges a callback code and preserves the existing auth handoff', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/v1/auth/exchange'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'one-time-code' }),
      });
    });
    expect(persistSession).toHaveBeenCalledWith({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
    expect(window.location.search).toBe('');

    window.dispatchEvent(new CustomEvent('auth-ready'));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
  });

  it('says which account signed in once auth is ready (#2292)', async () => {
    window.history.replaceState(null, '', '/auth/callback?code=one-time-code');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh-token' }),
    });

    render(<CallbackPage />);
    await waitFor(() => expect(persistSession).toHaveBeenCalled());

    window.dispatchEvent(
      new CustomEvent('auth-ready', { detail: { user: { email: 'player@example.com' } } }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/app'));
    expect(toastSuccess).toHaveBeenCalledWith('Signed in as player@example.com');
  });

  it('uses the deprecated fragment fallback only when no code is present', async () => {
    window.history.replaceState(
      null,
      '',
      '/auth/callback#access_token=legacy-access&refresh_token=legacy-refresh',
    );

    render(<CallbackPage />);

    await waitFor(() => expect(persistSession).toHaveBeenCalledTimes(1));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(persistSession).toHaveBeenCalledWith({
      access_token: expect.any(String),
      refresh_token: expect.any(String),
    });
  });
});
