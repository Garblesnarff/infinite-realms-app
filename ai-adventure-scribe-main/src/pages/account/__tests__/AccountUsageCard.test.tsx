import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { AccountUsageCard } from '../AccountUsageCard';

import type { QuotaStatus } from '@/hooks/use-account-billing';

// Fixtures follow the real GET /v1/llm/quota producer shape as mapped by
// useAccountBilling (QuotaStatus): headline llm fields plus quotas for
// llm/image counts and voice characters (#2510).
const quota = (overrides: Partial<QuotaStatus> = {}): QuotaStatus => ({
  plan: 'free',
  type: 'llm',
  used: 3,
  limit: 15,
  remaining: 12,
  resetAt: '2026-09-28T00:00:00.000Z',
  quotas: {
    llm: { used: 3, limit: 15, remaining: 12 },
    image: { used: 0, limit: 1, remaining: 1 },
    voice: { used: 0, limit: 0, remaining: 0 },
  },
  ...overrides,
});

describe('AccountUsageCard (#2292)', () => {
  it('states the reset time once, in local time', () => {
    const resetAt = '2026-09-28T00:00:00.000Z';
    render(<AccountUsageCard quota={quota({ resetAt })} />);

    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
    expect(
      screen.getByText(`Resets at: ${new Date(resetAt).toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('shows remaining counts for messages, images and voice characters', () => {
    render(
      <AccountUsageCard
        quota={quota({
          plan: 'pro',
          quotas: {
            llm: { used: 5, limit: 40, remaining: 35 },
            image: { used: 1, limit: 2, remaining: 1 },
            voice: { used: 500, limit: 2000, remaining: 1500 },
          },
        })}
      />,
    );

    expect(screen.getByText('5 / 40 — 35 remaining')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 — 1 remaining')).toBeInTheDocument();
    expect(screen.getByText('500 / 2000 characters — 1500 remaining')).toBeInTheDocument();
  });

  it('shows the usage count alone when the limit is unknown (#2343 C6)', () => {
    render(
      <AccountUsageCard
        quota={quota({
          used: 7,
          limit: -1,
          remaining: 0,
          quotas: {
            llm: { used: 7, limit: -1, remaining: 0 },
            image: { used: 0, limit: 1, remaining: 1 },
            voice: { used: 0, limit: 0, remaining: 0 },
          },
        })}
      />,
    );

    expect(screen.queryByText(/Unlimited/)).not.toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('tells a free user premium voice is Legend only instead of a 0-character quota', () => {
    render(<AccountUsageCard quota={quota()} />);

    expect(screen.getByText('Premium voice: Legend only')).toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0 characters/)).not.toBeInTheDocument();
  });
});
