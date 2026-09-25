import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import EmptyState from '../empty-state';

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

const LocationProbe = (): React.JSX.Element => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderEmptyState = (): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={['/app/']}>
      <EmptyState />
      <LocationProbe />
    </MemoryRouter>,
  );

describe('campaign list empty state (#2192)', () => {
  it('hides the Create Campaign button when the flag is off', () => {
    setFlag(false);
    renderEmptyState();

    expect(screen.getByText(/no campaigns found/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create campaign/i })).not.toBeInTheDocument();
  });

  it('offers the pre-built campaigns when the flag is off', async () => {
    setFlag(false);
    renderEmptyState();

    fireEvent.click(screen.getByRole('button', { name: /explore pre-built campaigns/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/explore', {
        normalizeWhitespace: false,
      }),
    );
  });

  it('navigates to the wizard when the flag is on', async () => {
    setFlag(true);
    renderEmptyState();

    expect(
      screen.queryByRole('button', { name: /explore pre-built campaigns/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /create campaign/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/app/campaigns/create', {
        normalizeWhitespace: false,
      }),
    );
  });
});
