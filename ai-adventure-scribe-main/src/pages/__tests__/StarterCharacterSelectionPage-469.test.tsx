import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
