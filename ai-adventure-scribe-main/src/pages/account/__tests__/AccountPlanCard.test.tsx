import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountPlanCard } from '../AccountPlanCard';

const renderCard = (isPro: boolean, isTester = false): ReturnType<typeof render> =>
  render(
    <AccountPlanCard
      isPro={isPro}
      isTester={isTester}
      subscription={null}
      loading={false}
      upgradePriceLabel="$9.99/month"
      onUpgrade={vi.fn()}
      onManageSubscription={vi.fn()}
    />,
  );

describe('AccountPlanCard (#2415)', () => {
  it('labels the messages card on Free as the Legend upgrade, not a current promise', () => {
    renderCard(false);

    expect(screen.getByText('Free Tier')).toBeInTheDocument();
    expect(screen.getByText('Legend: More AI Messages')).toBeInTheDocument();
    expect(screen.getByText('More DM messages every day on Legend')).toBeInTheDocument();
    expect(screen.queryByText(/Unlimited/)).not.toBeInTheDocument();
  });

  it('shows no upgrade benefits to a Legend subscriber', () => {
    renderCard(true);

    expect(screen.getByText('Legend Tier')).toBeInTheDocument();
    expect(screen.queryByText(/Unlimited/)).not.toBeInTheDocument();
    expect(screen.queryByText(/More AI Messages/)).not.toBeInTheDocument();
  });

  it('labels a tester account Tester and offers neither Upgrade nor Manage Subscription (#2474)', () => {
    // AccountPage passes isPro = planHasPaidFeatures('tester') = true, isTester = true.
    renderCard(true, true);

    expect(screen.getByText('Tester')).toBeInTheDocument();
    expect(screen.queryByText('Legend Tier')).not.toBeInTheDocument();
    expect(screen.queryByText('Free Tier')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upgrade/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Manage Subscription/ })).not.toBeInTheDocument();
  });
});
