import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { launchPageContent } from '@/data/launchPageContent';
import { AccountPlanCard } from '@/pages/account/AccountPlanCard';

const PHRASES = [
  'custom hero creation',
  'keep a hero across adventures',
  'higher limits',
  'premium voices',
] as const;

describe('Legend adds (#1239)', () => {
  it('pins what Legend adds on the launch plan and the account card', () => {
    const legend = launchPageContent.pricing.plans.find((plan) => plan.name === 'Legend');
    const help = launchPageContent.helpShape.perks.map((perk) => perk.description).join('\n');
    const launchText = `${legend?.description ?? ''}\n${help}`;
    for (const phrase of PHRASES) {
      expect(launchText).toContain(phrase);
    }

    render(
      <AccountPlanCard
        isPro={false}
        subscription={null}
        loading={false}
        upgradePriceLabel="$9.99/month"
        onUpgrade={vi.fn()}
        onManageSubscription={vi.fn()}
      />,
    );

    const card = screen.getByText(
      'Legend adds custom hero creation, lets you keep a hero across adventures, higher limits, and premium voices.',
    );
    expect(card).toBeInTheDocument();
    for (const phrase of PHRASES) {
      expect(card.textContent).toContain(phrase);
    }
  });
});
