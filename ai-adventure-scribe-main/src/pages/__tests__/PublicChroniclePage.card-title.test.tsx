/**
 * #1607: the campaign card title on /chronicle/:token stays inside the card when
 * the card has no cover. The real chronicle.css is injected so jsdom applies the cascade.
 */
import { readFileSync } from 'node:fs';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PublicChroniclePage from '../PublicChroniclePage';

const TOKEN = 'token-xyz-123';

function renderPage(token = TOKEN): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/chronicle/${token}`]}>
        <Routes>
          <Route path="/chronicle/:token" element={<PublicChroniclePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('campaign card title stays inside the card (#1607)', () => {
  const fetchMock = vi.fn();
  let styleEl: HTMLStyleElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    const css = readFileSync(
      'src/features/game-session/components/game/chronicle/chronicle.css',
      'utf8',
    );
    styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  });

  afterEach(() => {
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
    styleEl = null;
    document.body.classList.remove('ir-table-look');
    vi.unstubAllGlobals();
  });

  function noCoverBody(): Record<string, unknown> {
    return {
      title: 'Ropes Cut from Below',
      illustrationUrl: null,
      story: 'Para one.\n\nPara two.',
      campaignName: 'Abyssal Descent',
      sessionNumber: 3,
      publicCampaign: {
        slug: 'abyssal-descent',
        title: 'Abyssal Descent',
        tagline: 'Descend into the dark.',
        coverImageUrl: null,
      },
    };
  }

  function coverBody(): Record<string, unknown> {
    return {
      title: 'Ropes Cut from Below',
      illustrationUrl: null,
      story: 'Para one.\n\nPara two.',
      campaignName: 'Abyssal Descent',
      sessionNumber: 3,
      publicCampaign: {
        slug: 'abyssal-descent',
        title: 'Abyssal Descent',
        tagline: 'Descend into the dark.',
        coverImageUrl: 'https://example.com/cover.jpg',
      },
    };
  }

  it('table look, no cover: the card body is not pulled above the card top', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => noCoverBody() });
    document.body.classList.add('ir-table-look');
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Abyssal Descent' });
    const body = document.querySelector('.ir-chronicle-aside-body') as HTMLElement;
    const cs = getComputedStyle(body);
    expect(cs.marginTop).toBe('0px');
    expect(cs.paddingTop).toBe('26px');
  });

  it('table look, with a cover: the body still overlaps the cover fade by 30px', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => coverBody() });
    document.body.classList.add('ir-table-look');
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Abyssal Descent' });
    const body = document.querySelector('.ir-chronicle-aside-body') as HTMLElement;
    const cs = getComputedStyle(body);
    expect(cs.marginTop).toBe('-30px');
    expect(cs.paddingTop).toBe('0px');
  });

  it('plain look: top padding only when there is no cover', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => noCoverBody() });
    const r1 = renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Abyssal Descent' });
    const body1 = document.querySelector('.ir-chronicle-aside-body') as HTMLElement;
    expect(body1.classList.contains('pt-6')).toBe(true);
    r1.unmount();

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => coverBody() });
    renderPage();
    await screen.findByRole('heading', { level: 2, name: 'Abyssal Descent' });
    const body2 = document.querySelector('.ir-chronicle-aside-body') as HTMLElement;
    expect(body2.classList.contains('pt-6')).toBe(false);
  });
});
