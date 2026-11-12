import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaign: () => ({
    campaign: { id: 'sc1', title: 'Abyssal Descent' },
    isLoading: false,
  }),
}));
vi.mock('@/hooks/use-starter-character-templates', () => ({
  useStarterCharacterTemplates: () => ({
    templates: [],
    isLoading: false,
    error: null,
    retry: vi.fn(),
  }),
}));
vi.mock('@/services/character/starter-character-seeding', () => ({
  seedStarterCharacter: vi.fn(),
}));

import StarterCharacterSelectionPage from '../StarterCharacterSelectionPage';

describe('StarterCharacterSelectionPage without ?campaignId (#469)', () => {
  it('redirects to the campaign page instead of showing the load error', async () => {
    render(
      <MemoryRouter initialEntries={['/explore/abyssal-descent/choose-character']}>
        <Routes>
          <Route
            path="/explore/:slug/choose-character"
            element={<StarterCharacterSelectionPage />}
          />
          <Route path="/explore/:slug" element={<div>campaign detail page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('campaign detail page')).toBeTruthy();
  });
});

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <div data-testid="target">{`${location.pathname}${location.search}${location.hash}`}</div>;
}

describe('StarterCharacterSelectionPage keeps the campaign (#2517)', () => {
  it('forwards ?campaignId= and the heroes anchor to the campaign page', async () => {
    render(
      <MemoryRouter
        initialEntries={['/explore/abyssal-descent/choose-character?campaignId=camp-1']}
      >
        <Routes>
          <Route
            path="/explore/:slug/choose-character"
            element={<StarterCharacterSelectionPage />}
          />
          <Route path="/explore/:slug" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('target')).toHaveTextContent(
      '/explore/abyssal-descent?campaignId=camp-1#heroes',
    );
  });
});
