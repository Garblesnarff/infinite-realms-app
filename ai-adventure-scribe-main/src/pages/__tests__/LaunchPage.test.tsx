import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

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

  it('keeps the "No waitlist" hero pill', () => {
    renderPage();
    expect(screen.getByText('Open beta · Free to play · No waitlist')).toBeInTheDocument();
  });

  it('has no email form on the landing page; the Join section sends visitors to /explore', () => {
    const { container } = renderPage();
    expect(screen.queryAllByRole('form')).toHaveLength(0);
    // queryAllByRole('form') only counts forms with an accessible name; a
    // nameless <form> would slip past it, so check the DOM directly too.
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toMatch(/get updates by email/i);
    expect(screen.getByText('Be a founding adventurer')).toBeInTheDocument();
    const play = container.querySelector('[data-track-cta="play_free"]') as Node;
    const join = screen.getByRole('link', { name: 'Join the beta' });
    expect(join).toHaveAttribute('href', '/explore');
    expect(join).toHaveAttribute('data-track-cta', 'play_free_join');
    expect(play.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('shows no voice player until the sample file ships', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /voice sample/i })).toBeNull();
    });
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows the voice play control when the sample file ships', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null),
        },
      }),
    );
    renderPage();
    const button = await screen.findByRole('button', { name: /voice sample/i });
    expect(button).toBeEnabled();
    expect(button.className).toMatch(/h-16/);
    expect(button.className).toMatch(/w-16/);
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('hides the voice play control when HEAD returns 200 text/html (SPA fallback)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html' : null),
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: /voice sample/i })).toBeNull();
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('shows the voice play control when HEAD returns 200 audio/mpeg (case-insensitive)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'Audio/MPEG' : null),
        },
      }),
    );
    renderPage();
    const button = await screen.findByRole('button', { name: /voice sample/i });
    expect(button).toBeEnabled();
    expect(button.className).toMatch(/h-16/);
    expect(button.className).toMatch(/w-16/);
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('hides the voice play control when HEAD returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /voice sample/i })).toBeNull();
    });
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('hides the voice play control when HEAD fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /voice sample/i })).toBeNull();
    });
    expect(
      screen.getByText('Press Listen on any message and the DM reads it aloud.'),
    ).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('plays the sample when the Play control is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === 'content-type' ? 'audio/mpeg' : null),
        },
      }),
    );
    const playMock = vi.fn().mockResolvedValue(undefined);
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = playMock as unknown as typeof HTMLMediaElement.prototype.play;
    try {
      renderPage();
      const button = await screen.findByRole('button', { name: /voice sample/i });
      expect(playMock).not.toHaveBeenCalled();
      fireEvent.click(button);
      await waitFor(() => {
        expect(playMock).toHaveBeenCalled();
      });
      expect(
        screen.getByText('Press Listen on any message and the DM reads it aloud.'),
      ).toBeInTheDocument();
    } finally {
      HTMLMediaElement.prototype.play = originalPlay;
      vi.unstubAllGlobals();
    }
  });

  it('has no signup form on the page', () => {
    renderPage();
    expect(screen.queryAllByRole('form')).toHaveLength(0);
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
