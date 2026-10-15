import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProtectedRoute from '../ProtectedRoute';

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => useAuthMock(...args),
}));

vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    SESSION_ENDED_MESSAGE: 'Session ended — sign in again',
  }),
);

const baseAuth = {
  user: null,
  session: null,
  sessionEnded: false,
  loading: false,
  connectionError: false,
  blogRole: null,
  blogRoleLoading: false,
  isBlogAdmin: false,
  refreshBlogRole: vi.fn(),
  userPlan: null,
  userPlanLoading: false,
  userPlanError: false,
  refreshUserPlan: vi.fn(),
  refreshAuth: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

describe('ProtectedRoute connection error (#565)', () => {
  it('offers Retry instead of the sign-in page when the backend was unreachable', () => {
    const refreshAuth = vi.fn().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue({ ...baseAuth, connectionError: true, refreshAuth });

    render(
      <ProtectedRoute>
        <div>app</div>
      </ProtectedRoute>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Connection issue');
    expect(screen.queryByText('app')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });

  it('still renders children once the user is set, even with a stale connectionError', () => {
    useAuthMock.mockReturnValue({
      ...baseAuth,
      connectionError: true,
      user: { id: 'u1', email: 'player@example.com' },
    });

    render(
      <ProtectedRoute>
        <div>app</div>
      </ProtectedRoute>,
    );

    expect(screen.getByText('app')).toBeInTheDocument();
  });
});
