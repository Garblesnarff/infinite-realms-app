import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { AccountUsageCard } from '../AccountUsageCard';

describe('AccountUsageCard (#2292)', () => {
  it('states the reset time once, in local time', () => {
    const resetAt = '2026-09-28T00:00:00.000Z';
    render(
      <AccountUsageCard
        quota={{ plan: 'free', type: 'message', used: 3, limit: 50, remaining: 47, resetAt }}
      />,
    );

    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
    expect(
      screen.getByText(`Resets at: ${new Date(resetAt).toLocaleString()}`),
    ).toBeInTheDocument();
  });

  it('shows the usage count alone when the limit is unknown (#2343 C6)', () => {
    render(
      <AccountUsageCard
        quota={{
          plan: 'free',
          type: 'message',
          used: 7,
          limit: -1,
          remaining: 0,
          resetAt: '2026-09-28T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.queryByText(/Unlimited/)).not.toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
