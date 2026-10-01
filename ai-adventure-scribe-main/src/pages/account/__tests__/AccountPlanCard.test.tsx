import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountPlanCard } from '../AccountPlanCard';

const renderCard = (isPro: boolean): ReturnType<typeof render> =>
  render(
    <AccountPlanCard
      isPro={isPro}
      subscription={null}
      loading={false}
      upgradePriceLabel="$9.99/month"
      onUpgrade={vi.fn()}
      onManageSubscription={vi.fn()}
    />,
  );

describe('AccountPlanCard (#2415)', () => {
  it('labels the unlimited-messages card on Free as the Legend upgrade, not a current promise', () => {
    renderCard(false);

    expect(screen.getByText('Free Tier')).toBeInTheDocument();
    expect(screen.getByText('Legend: Unlimited AI Messages')).toBeInTheDocument();
    expect(screen.getByText('No daily limits once you upgrade to Legend')).toBeInTheDocument();
    expect(screen.queryByText('Unlimited AI Messages')).not.toBeInTheDocument();
  });

  it('shows no upgrade benefits to a Legend subscriber', () => {
    renderCard(true);

    expect(screen.getByText('Legend Tier')).toBeInTheDocument();
    expect(screen.queryByText(/Unlimited AI Messages/)).not.toBeInTheDocument();
  });
});
