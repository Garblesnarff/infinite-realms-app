import { render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import LaunchPage from '../LaunchPage';
import PricingPage from '../PricingPage';

import { ACCOUNT_UPGRADE_PRICE } from '@/hooks/use-account-billing';

// The landing campaign row loads campaigns from the API; the landing page tests do not need it.
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({
    campaigns: [],
    featuredCampaigns: [],
    isLoading: false,
    error: null,
  }),
}));

const renderIn = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(
    <HelmetProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </HelmetProvider>,
  );

const renderPage = (): ReturnType<typeof render> => renderIn(<LaunchPage />);
// Pricing and the FAQ moved from the landing page to /pricing (Table 12, Rob 11-06).
const renderPricing = (): ReturnType<typeof render> => renderIn(<PricingPage />);

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

  it('offers the play CTA at /explore in the hero, and keeps Sign in', () => {
    renderPage();

    const playLinks = screen
      .getAllByRole('link', { name: /roll for initiative/i })
      .filter((a) => a.getAttribute('href') === '/explore');
    const tracked = playLinks.map((a) => a.getAttribute('data-track-cta'));
    expect(tracked).toContain('play_free');
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it('shows the Free and Legend plans with the real price and no Unlimited or strike-through', () => {
    const { container } = renderPricing();

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
    const { container } = renderPricing();
    const link = container.querySelector('a[href="/terms"][class*="d5b070"]');
    expect(link?.textContent).toBe('Terms of Service');
  });

  it('does not promise absolute data privacy and links the privacy FAQ to /privacy', () => {
    const { container } = renderPricing();
    expect(container.textContent).not.toMatch(/never share your personal data/i);
    const faqLinks = [...container.querySelectorAll('a[href="/privacy"]')].filter(
      (a) => a.className.includes('underline') && a.textContent === 'Privacy Policy',
    );
    expect(faqLinks).toHaveLength(1);
  });

  it('puts the email-list form after the play CTA on the landing page', () => {
    const { container } = renderPage();
    const play = container.querySelector('[data-track-cta="play_free"]') as Node;
    const form = screen.getAllByRole('form', { name: /get updates by email/i })[0] as Node;
    expect(play.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the legal links and the FAQ link in the footer', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    expect(screen.getByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/pricing#faq');
  });

  it('shows no voice player until the sample file ships', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /voice sample/i })).toBeNull();
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
  });

  it('has exactly one signup form on the page', () => {
    renderPage();
    expect(screen.getAllByRole('form')).toHaveLength(1);
  });

  it('carries none of the retired beta story strings', () => {
    const { container } = renderPage();
    const text = container.textContent ?? '';
    // "perfect memory", "professional voice" and "founding" are the Table 12 board copy now
    // (Rob, 11-06: the design wins), so they are no longer retired.
    for (const retired of [
      /closed beta/i,
      /founder's alpha/i,
      /waitlist number/i,
      /first-come/i,
      /unlike other ais/i,
      /early access/i,
    ]) {
      expect(text).not.toMatch(retired);
    }
  });

  it('states the Legend price from the pricing label, not a typed price', () => {
    const { container } = renderPricing();
    expect(container.textContent).toContain(`Legend costs ${ACCOUNT_UPGRADE_PRICE.label}`);
  });
});
