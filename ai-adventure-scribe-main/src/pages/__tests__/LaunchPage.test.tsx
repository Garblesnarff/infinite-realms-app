import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import LaunchPage from '../LaunchPage';

import { ACCOUNT_UPGRADE_PRICE } from '@/hooks/use-account-billing';

// StarterCampaignsSection loads campaigns from the API; the landing page tests do not need it.
vi.mock('@/components/launch/StarterCampaignsSection', () => ({
  StarterCampaignsSection: () => null,
}));

const renderPage = (): ReturnType<typeof render> =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <LaunchPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

describe('LaunchPage', () => {
  beforeAll(() => {
    // The Radix checkbox in WaitlistForm measures itself; jsdom has no ResizeObserver.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('offers Play free at /explore in the hero and the footer, and keeps Sign in', () => {
    renderPage();

    const playLinks = screen
      .getAllByRole('link', { name: /play free/i })
      .filter((a) => a.getAttribute('href') === '/explore');
    const tracked = playLinks.map((a) => a.getAttribute('data-track-cta'));
    expect(tracked).toContain('play_free');
    expect(tracked).toContain('play_free_footer');
    expect(tracked).toContain('play_free_footer_bar');
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('shows the Free and Legend plans with the real price and no Unlimited or strike-through', () => {
    const { container } = renderPage();

    const pricing = container.querySelector('#pricing') as HTMLElement;
    expect(pricing).not.toBeNull();
    expect(pricing.textContent).toContain('Free');
    expect(pricing.textContent).toContain('Legend');
    expect(pricing.textContent).toContain(ACCOUNT_UPGRADE_PRICE.label);
    expect(pricing.textContent).toContain('15 DM messages a day');
    expect(pricing.textContent).toContain('40 DM messages a day');
    expect(container.textContent).not.toMatch(/unlimited/i);
    expect(container.querySelector('s, del, .line-through')).toBeNull();
  });

  it('has no hard-coded waitlist count', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/\d+\+ adventurers/);
  });

  it('points the refund FAQ answer at /terms', () => {
    const { container } = renderPage();
    const link = container.querySelector('a[href="/terms"][class*="purple-400"]');
    expect(link?.textContent).toBe('Terms of Service');
  });

  it('does not promise absolute data privacy and links the privacy FAQ to /privacy', () => {
    const { container } = renderPage();
    expect(container.textContent).not.toMatch(/never share your personal data/i);
    const faqLinks = [...container.querySelectorAll('a[href="/privacy"]')].filter(
      (a) => a.className.includes('underline') && a.textContent === 'Privacy Policy',
    );
    expect(faqLinks).toHaveLength(1);
  });

  it('puts the waitlist form after the Play CTA in the early-access section', () => {
    const { container } = renderPage();
    const play = container.querySelector('[data-track-cta="play_free_early_access"]') as Node;
    const form = screen.getAllByRole('form', { name: /join beta waitlist/i })[0] as Node;
    expect(play.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
