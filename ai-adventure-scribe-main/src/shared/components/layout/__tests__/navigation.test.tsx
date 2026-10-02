import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Navigation from '../navigation';

import { TooltipProvider } from '@/components/ui/tooltip';

const authState = vi.hoisted(() => ({
  value: {
    user: { id: 'user-1', email: 'player@example.com' } as { id: string; email: string } | null,
    userPlan: 'free' as string | null,
    isBlogAdmin: false,
    signOut: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

function renderNav() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <TooltipProvider delayDuration={0}>
        <Navigation />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe('Navigation (#2292)', () => {
  beforeEach(() => {
    authState.value.user = { id: 'user-1', email: 'player@example.com' };
    authState.value.userPlan = 'free';
  });

  it('shows Upgrade, not Legend, on a Free account', () => {
    renderNav();
    expect(screen.getByText('Upgrade')).toBeInTheDocument();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
  });

  it('shows no plan badge while the plan is unknown', () => {
    authState.value.userPlan = null;
    renderNav();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
  });

  it('shows Legend only on a paid plan', () => {
    authState.value.userPlan = 'pro';
    renderNav();
    expect(screen.getByText('Legend')).toBeInTheDocument();
  });

  it('shows Tester, not Upgrade or Legend, on a tester account (#2474)', () => {
    authState.value.userPlan = 'tester';
    renderNav();
    expect(screen.getByText('Tester')).toBeInTheDocument();
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
    expect(screen.queryByText('Legend')).not.toBeInTheDocument();
  });

  it('labels the settings icon "Account" and shows the signed-in email', async () => {
    renderNav();
    const link = screen.getByRole('link', { name: 'Account' });
    expect(link).toHaveAttribute('href', '/app/account');
    expect(link).toHaveTextContent('Signed in as player@example.com');

    await act(async () => {
      link.focus();
    });
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Account');
  });
});
