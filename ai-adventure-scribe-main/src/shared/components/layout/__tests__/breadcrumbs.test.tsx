import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import Breadcrumbs from '../breadcrumbs';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    state: { campaign: { id: '3c446d3d-e7e8-4d4f-9064-a31c1d5d33d1', name: 'Abyssal Descent' } },
  }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/hooks/use-entity-label', () => ({
  useEntityLabel: () => ({ label: null, loading: false }),
}));

describe('game breadcrumb', () => {
  it('shows the campaign name instead of the campaign id', () => {
    render(
      <MemoryRouter
        initialEntries={['/app/game/3c446d3d-e7e8-4d4f-9064-a31c1d5d33d1?session=3f798abe']}
      >
        <Breadcrumbs />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Abyssal Descent' })).toBeInTheDocument();
    expect(screen.queryByText(/3c446d3d/)).not.toBeInTheDocument();
  });
});
