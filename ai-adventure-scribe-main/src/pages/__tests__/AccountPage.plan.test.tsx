import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AccountPage from '@/pages/AccountPage';

// Mutable auth state: each test sets the plan scenario, then renders the
// real AccountPage against it.
const authState = vi.hoisted(() => ({
  user: { email: 'tester@example.test' },
  userPlan: null as string | null,
  userPlanLoading: true,
  userPlanError: false,
  refreshUserPlan: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/hooks/use-account-billing', () => ({
  ACCOUNT_UPGRADE_PRICE: { label: '$5 / month' },
  useAccountBilling: () => ({
    subscription: null,
    quota: null,
    loading: false,
    handleUpgrade: vi.fn(),
    handleManageSubscription: vi.fn(),
  }),
}));

vi.mock('@/components/feedback/SendFeedbackButton', () => ({
  SendFeedbackButton: () => null,
}));

const setPlanState = (state: Partial<typeof authState>): void => {
  Object.assign(authState, {
    userPlan: null,
    userPlanLoading: false,
    userPlanError: false,
    ...state,
  });
  authState.refreshUserPlan.mockClear();
};

describe('AccountPage plan states (#351)', () => {
  it('shows a neutral loading state — never "Free Tier" — while the plan loads', () => {
    setPlanState({ userPlan: null, userPlanLoading: true });

    render(<AccountPage />);

    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    expect(screen.getByText('Loading plan…')).toBeInTheDocument();
    expect(screen.queryByText('Free Tier')).not.toBeInTheDocument();
  });

  it('shows "Plan unavailable — retry" when the fetch failed with no known plan', () => {
    setPlanState({ userPlan: null, userPlanError: true });

    render(<AccountPage />);

    expect(screen.getByTestId('plan-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Plan unavailable — retry')).toBeInTheDocument();
    expect(screen.queryByText('Free Tier')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(authState.refreshUserPlan).toHaveBeenCalledTimes(1);
  });

  it('never renders the plan card for an indeterminate plan (not loading, no error)', () => {
    setPlanState({ userPlan: null, userPlanLoading: false, userPlanError: false });

    render(<AccountPage />);

    expect(screen.getByTestId('plan-loading')).toBeInTheDocument();
    expect(screen.queryByText('Free Tier')).not.toBeInTheDocument();
  });

  it('shows Free Tier for a real free response', () => {
    setPlanState({ userPlan: 'free' });

    render(<AccountPage />);

    expect(screen.getByText('Free Tier')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-unavailable')).not.toBeInTheDocument();
  });

  it('shows the tester label once a tester plan is known', () => {
    setPlanState({ userPlan: 'tester' });

    render(<AccountPage />);

    expect(screen.getByText('Tester')).toBeInTheDocument();
    expect(screen.queryByText('Free Tier')).not.toBeInTheDocument();
  });
});
