import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AccountUsageCard } from '../AccountUsageCard';

import type { QuotaStatus } from '@/hooks/use-account-billing';

// Fixtures follow the real GET /v1/llm/quota producer shape as mapped by
// useAccountBilling (QuotaStatus): headline llm fields plus quotas for
// llm/image counts and voice characters (#2510). The card shows the voice
// characters as premium minutes left (#58).
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

  it('shows remaining counts for messages and images, and premium voice minutes left', () => {
    const voiceResetAt = '2026-12-01T00:00:00.000Z';
    render(
      <AccountUsageCard
        quota={quota({
          plan: 'pro',
          quotas: {
            llm: { used: 5, limit: 40, remaining: 35 },
            image: { used: 1, limit: 2, remaining: 1 },
            voice: { used: 9000, limit: 54000, remaining: 45000, resetAt: voiceResetAt },
          },
        })}
      />,
    );

    expect(screen.getByText('5 / 40 — 35 remaining')).toBeInTheDocument();
    expect(screen.getByText('1 / 2 — 1 remaining')).toBeInTheDocument();
    // 9,000 / 54,000 characters = 10 / 60 minutes, 50 left (#58).
    expect(screen.getByText('10 / 60 minutes — 50 remaining')).toBeInTheDocument();
    // Literal date, not a toLocaleDateString round-trip: the component formats
    // in UTC, and a test that formats the same way would shift with it
    // (Dec 1 00:00Z reads Nov 30 in US timezones without timeZone: 'UTC').
    expect(screen.getByText('Premium voice resets December 1')).toBeInTheDocument();
  });

  it('derives remaining minutes so used + remaining = limit, not floored separately', () => {
    render(
      <AccountUsageCard
        quota={quota({
          plan: 'pro',
          quotas: {
            llm: { used: 0, limit: 40, remaining: 40 },
            image: { used: 0, limit: 2, remaining: 2 },
            // 53,101 chars used: floored separately that is 59 used with
            // 899 chars (0 minutes) remaining. The card shows 1 minute left.
            voice: {
              used: 53101,
              limit: 54000,
              remaining: 899,
              resetAt: '2026-12-01T00:00:00.000Z',
            },
          },
        })}
      />,
    );

    expect(screen.getByText('59 / 60 minutes — 1 remaining')).toBeInTheDocument();
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

  it('tells a free user premium voice is Legend only instead of a 0-minute quota', () => {
    render(<AccountUsageCard quota={quota()} />);

    expect(screen.getByText('Premium voice: Legend only')).toBeInTheDocument();
    expect(screen.queryByText(/0 \/ 0 minutes/)).not.toBeInTheDocument();
  });
});
