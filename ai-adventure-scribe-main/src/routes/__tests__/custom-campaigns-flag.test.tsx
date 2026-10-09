import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

import { ProtectedAppRoutes } from '../ProtectedAppRoutes';

// #2192: the flag is build-time inlined (import.meta.env), so tests toggle it
// through a mutable cell via vi.hoisted.
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

// Auth passes through; the flag, not the session, is under test.
vi.mock('@/features/auth', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/shared/components/layout/breadcrumbs', () => ({
  default: () => <div data-testid="breadcrumbs" />,
}));
vi.mock('@/shared/components/layout/navigation', () => ({
  default: () => <div data-testid="navigation" />,
}));

// Every lazy page module gets a stub; only the wizard and the campaign-list
// home page carry assertions.
const stub = (testId: string): { default: () => React.JSX.Element } => ({
  default: () => <div data-testid={testId} />,
});

vi.mock('@/pages/Index', () => stub('index-page'));
vi.mock('@/features/character/components/sheet/character-sheet', () => stub('character-sheet'));
vi.mock('@/features/character/components/list/character-list', () => stub('character-list'));
vi.mock('@/features/campaign/components/creation/campaign-wizard', () => ({
  default: () => <div data-testid="campaign-wizard">Campaign wizard</div>,
}));
vi.mock('@/features/game-session/components/game/GameContentWithErrorBoundary', () =>
  stub('game-content'),
);
vi.mock('@/pages/CharacterCreateEntry', () => stub('character-create-entry'));
vi.mock('@/pages/campaigns/CampaignHubWithErrorBoundary', () => ({
  default: () => <div data-testid="campaign-hub">Campaign hub</div>,
}));
vi.mock('@/pages/BlogAdmin', () => stub('blog-admin'));
vi.mock('@/pages/BlogEditor', () => stub('blog-editor'));
vi.mock('@/pages/AccountPage', () => stub('account'));

const LocationProbe = (): React.JSX.Element => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

const renderAt = (path: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/app/*"
          element={
            <>
              <ProtectedAppRoutes />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe('custom campaign wizard flag (#2192)', () => {
  it('redirects /app/campaigns/create to the campaign list when the flag is off', async () => {
    setFlag(false);
    renderAt('/app/campaigns/create');

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/app/', {
        normalizeWhitespace: false,
      }),
    );
    expect(screen.queryByTestId('campaign-wizard')).not.toBeInTheDocument();
    // The redirect target is the home page, which renders the campaign list.
    expect(await screen.findByTestId('index-page')).toBeInTheDocument();
  });

  it('renders the wizard at /app/campaigns/create when the flag is on', async () => {
    setFlag(true);
    renderAt('/app/campaigns/create');

    expect(await screen.findByTestId('campaign-wizard')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/campaigns/create', {
      normalizeWhitespace: false,
    });
  });

  it('keeps existing campaigns reachable for their owner when the flag is off', async () => {
    setFlag(false);
    renderAt('/app/campaigns/campaign-123');

    expect(await screen.findByTestId('campaign-hub')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/campaigns/campaign-123', {
      normalizeWhitespace: false,
    });
    expect(screen.queryByTestId('campaign-wizard')).not.toBeInTheDocument();
  });
});
