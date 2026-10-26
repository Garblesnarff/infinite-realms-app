/**
 * Launch page copy pins for #1131 (Hark Sun2 V-005): no "Coming Soon" text on
 * the landing page (the book card is removed; the campaign line no longer
 * promises more), and the three spacing strings are already correct on main
 * and pinned here against regression as rendered strings. The beta note
 * spans a <span> plus text nodes, so it is pinned via textContent, not
 * getByText.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { EarlyAccessSection } from '../EarlyAccessSection';
import { FeaturesSection } from '../FeaturesSection';
import { FooterSection } from '../FooterSection';
import { PricingSection } from '../PricingSection';
import { StarterCampaignsSection } from '../StarterCampaignsSection';

// StarterCampaignsSection loads campaigns via Supabase; the bottom CTA under
// test renders during loading, which is all this test needs.
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({
    featuredCampaigns: [],
    campaigns: [],
    isLoading: true,
    error: null,
  }),
}));

const withRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('launch page copy (#1131)', () => {
  it('has no Coming Soon card and no Coming Soon text in Features', () => {
    const { container } = render(<FeaturesSection />);
    expect(screen.queryByText('Your Campaign as a Book')).toBeNull();
    expect(container.textContent).not.toMatch(/coming soon/i);
  });

  it('campaign line names what exists, with no coming-soon text', () => {
    const { container } = withRouter(<StarterCampaignsSection />);
    expect(container.textContent).not.toMatch(/coming soon/i);
    expect(container.textContent).toContain(
      'Each campaign is hand-crafted with unique storylines, memorable NPCs, and rich world-building.',
    );
  });

  it('free plan price line has a space: "$0 forever"', () => {
    const { container } = withRouter(<PricingSection />);
    expect(container.textContent).toContain('$0 forever');
    expect(container.textContent).not.toContain('$0forever');
  });

  it('beta note has a space after the colon', () => {
    const { container } = withRouter(<EarlyAccessSection />);
    expect(container.textContent).toContain(
      'Note: This is a beta. Some things will break or change. Tell us, and we fix them.',
    );
    expect(container.textContent).not.toContain('Note:This');
  });

  it('footer has a space after the year', () => {
    const { container } = withRouter(<FooterSection />);
    expect(container.textContent).toContain('© 2026 Infinite Realms. All rights reserved.');
    expect(container.textContent).not.toContain('2026Infinite');
  });
});
