import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PUBLIC_CHRONICLE_PATH } from '../../../shared/chronicle-share-routes';
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

describe('PublicChroniclePage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    document.body.classList.remove('ir-table-look');
    vi.unstubAllGlobals();
  });

  it('renders the shared chronicle without an Authorization header', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Ropes Cut from Below',
        illustrationUrl: 'https://example.com/art.jpg',
        story: 'Para one of the story.\n\nPara two of the story.',
        campaignName: 'Abyssal Descent',
        sessionNumber: 3,
      }),
    });

    renderPage();

    expect(await screen.findByText('Ropes Cut from Below')).toBeInTheDocument();
    expect(screen.getByText('CHRONICLE · ABYSSAL DESCENT · SESSION 3')).toBeInTheDocument();
    expect(screen.getByText('Para one of the story.')).toBeInTheDocument();
    expect(screen.getByText('Para two of the story.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Abyssal Descent' })).toBeInTheDocument();
    expect(
      screen.getByText('You play the hero. An AI Dungeon Master tells the story.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find a campaign to play' })).toHaveAttribute(
      'href',
      '/explore',
    );
    expect(screen.queryByRole('link', { name: 'Play this campaign' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See other adventures' })).toHaveAttribute(
      'href',
      '/explore',
    );
    expect(screen.getByText('© 2026 InfiniteRealms. All rights reserved.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Infinite Realms, home' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByText(/notes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /notes/i })).not.toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(url.endsWith(PUBLIC_CHRONICLE_PATH(TOKEN))).toBe(true);
    expect(init.method).toBe('GET');
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('renders the not-available copy on 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });

    renderPage();

    expect(
      await screen.findByText(
        'This chronicle is not available. The link may have been turned off.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Explore adventures' }).length).toBeGreaterThan(0);
  });

  it('shows the loading copy while fetching', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getByText('Loading chronicle…')).toBeInTheDocument();
  });

  it('renders the public campaign aside with slug link when publicCampaign present', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Ropes Cut from Below',
        illustrationUrl: 'https://example.com/art.jpg',
        story: 'Para one of the story.\n\nPara two of the story.',
        campaignName: 'Abyssal Descent',
        sessionNumber: 3,
        publicCampaign: {
          slug: 'abyssal-descent',
          title: 'Abyssal Descent',
          tagline: 'A horror expedition into the Infinite Chasm.',
          coverImageUrl: 'https://example.com/cover.jpg',
        },
      }),
    });

    renderPage();

    expect(await screen.findByText('Ropes Cut from Below')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Abyssal Descent' })).toBeInTheDocument();
    expect(screen.getByText('A horror expedition into the Infinite Chasm.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Play this campaign' })).toHaveAttribute(
      'href',
      '/explore/abyssal-descent',
    );
    expect(screen.getByRole('link', { name: 'See other adventures' })).toHaveAttribute(
      'href',
      '/explore',
    );
    const asideImg = document.querySelector('aside img');
    expect(asideImg).toHaveAttribute('src', 'https://example.com/cover.jpg');
  });

  it('renders the same content and links with and without the table look', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        title: 'Ropes Cut from Below',
        illustrationUrl: 'https://example.com/art.jpg',
        story: 'Para one of the story.\n\nPara two of the story.',
        campaignName: 'Abyssal Descent',
        sessionNumber: 3,
      }),
    });

    const first = renderPage();
    expect(await screen.findByText('Ropes Cut from Below')).toBeInTheDocument();
    const plainPlay = screen.getByRole('link', { name: 'Find a campaign to play' });
    expect(plainPlay).toHaveAttribute('href', '/explore');
    expect(screen.getByRole('link', { name: 'See other adventures' })).toHaveAttribute(
      'href',
      '/explore',
    );
    first.unmount();

    document.body.classList.add('ir-table-look');
    renderPage();
    expect(await screen.findByText('Ropes Cut from Below')).toBeInTheDocument();
    const tablePlay = screen.getByRole('link', { name: 'Find a campaign to play' });
    expect(tablePlay).toHaveAttribute('href', '/explore');
    expect(screen.getByRole('link', { name: 'See other adventures' })).toHaveAttribute(
      'href',
      '/explore',
    );
    expect(screen.getByText('Para one of the story.')).toBeInTheDocument();
    document.body.classList.remove('ir-table-look');
  });
});
