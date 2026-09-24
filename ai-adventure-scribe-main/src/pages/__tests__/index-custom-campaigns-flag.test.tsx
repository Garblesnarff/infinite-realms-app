import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import Index from '@/pages/Index';

const { setFlag, getFlag } = vi.hoisted(() => {
  let on = false;
  return {
    setFlag: (value: boolean) => {
      on = value;
    },
    getFlag: () => on,
  };
});

vi.mock('@/config/featureFlags', () => ({
  isCustomCampaignsEnabled: () => getFlag(),
}));

vi.mock('@/features/campaign/components', () => ({
  CampaignList: () => <div data-testid="campaign-list" />,
}));

const renderIndex = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <Index />
    </MemoryRouter>,
  );

describe('home page wizard entry point (#2192)', () => {
  it('hides the Create Epic Saga button when the flag is off', () => {
    setFlag(false);
    renderIndex();

    expect(screen.queryByRole('button', { name: /create epic saga/i })).not.toBeInTheDocument();
    // The pre-built campaign entry point stays visible.
    expect(
      screen.getByRole('button', { name: /explore pre-built campaigns/i }),
    ).toBeInTheDocument();
  });

  it('shows the Create Epic Saga button when the flag is on', () => {
    setFlag(true);
    renderIndex();

    expect(screen.getByRole('button', { name: /create epic saga/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /explore pre-built campaigns/i }),
    ).toBeInTheDocument();
  });
});
