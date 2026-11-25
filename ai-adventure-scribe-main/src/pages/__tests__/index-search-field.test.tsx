/**
 * #228 MB-005: the /app campaign search field carries a search icon (not the
 * users icon) and fills the panel on narrow screens instead of stopping at
 * the 448px cap while the panel stretches.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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

describe('home page campaign search (#228 MB-005)', () => {
  it('shows a search icon, not a users icon, on the campaign search field', () => {
    setFlag(false);
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    const search = screen.getByLabelText('Search campaigns');
    expect(search.parentElement?.querySelector('svg.lucide-search')).not.toBeNull();
    expect(document.querySelector('svg.lucide-users')).toBeNull();
  });

  it('lets the search field fill the panel on narrow screens', () => {
    setFlag(false);
    render(
      <MemoryRouter>
        <Index />
      </MemoryRouter>,
    );

    const search = screen.getByLabelText('Search campaigns');
    // input -> relative wrapper -> width container.
    const container = search.parentElement?.parentElement;
    expect(container?.className).toContain('w-full');
    expect(container?.className).toContain('lg:max-w-md');
  });
});
