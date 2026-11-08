import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHRONICLE_SHARE_REQUEST,
  CHRONICLE_UNSHARE_REQUEST,
} from '../../../../shared/chronicle-share-routes';
import { SessionChronicleActions } from '../SessionChronicleActions';

import type { SessionListItem } from '../SessionCard';

const mockFetchWithAuth = vi.fn();
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

const sessionWithChronicle = {
  id: 'sess-1',
  session_number: 1,
  status: 'completed',
  start_time: null,
  end_time: null,
  summary: null,
  current_scene_description: null,
  turn_count: null,
  created_at: null,
  character: null,
  session_chronicles: [
    {
      id: 'chron-1',
      status: 'ready',
      chapter_title: 'Chapter I',
      share_token: null,
    },
  ],
} as SessionListItem;

describe('SessionChronicleActions', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  it('renders Share link and Turn link off for ready Pro chronicles', () => {
    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    expect(screen.getByRole('button', { name: 'Share link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn link off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share link' })).toHaveClass('h-11');
    expect(screen.getByRole('button', { name: 'Turn link off' })).toHaveClass('h-11');
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('Share link posts the share request and copies the URL', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shareToken: 'token-abc' }),
    });

    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));

    expect(await screen.findByText('Link copied!')).toBeInTheDocument();
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const [shareUrl, shareOptions] = mockFetchWithAuth.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(shareUrl.endsWith(CHRONICLE_SHARE_REQUEST.path('chron-1'))).toBe(true);
    expect(shareOptions.method).toBe(CHRONICLE_SHARE_REQUEST.method);
    expect(shareOptions.body).toBeUndefined();
    expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/chronicle/token-abc`);
  });

  it('Turn link off sends exactly CHRONICLE_UNSHARE_REQUEST', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shareEnabled: false }),
    });

    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    fireEvent.click(screen.getByRole('button', { name: 'Turn link off' }));

    expect(await screen.findByText('Link turned off')).toBeInTheDocument();
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const [unshareUrl, unshareOptions] = mockFetchWithAuth.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(unshareUrl.endsWith(CHRONICLE_UNSHARE_REQUEST.path('chron-1'))).toBe(true);
    expect(unshareOptions.method).toBe(CHRONICLE_UNSHARE_REQUEST.method);
    expect(unshareOptions.body).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Turn link off' })).not.toBeInTheDocument();
  });

  it('free owner with a live link sees Turn link off but no Share link', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shareEnabled: false }),
    });
    const downgradedSession = {
      ...sessionWithChronicle,
      session_chronicles: [
        {
          id: 'chron-1',
          status: 'ready',
          chapter_title: 'Chapter I',
          share_token: 'live-token',
        },
      ],
    } as SessionListItem;

    render(<SessionChronicleActions session={downgradedSession} userPlan="free" />);

    expect(screen.getByRole('button', { name: 'Turn link off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share link' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn link off' }));

    expect(await screen.findByText('Link turned off')).toBeInTheDocument();
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const [unshareUrl, unshareOptions] = mockFetchWithAuth.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(unshareUrl.endsWith(CHRONICLE_UNSHARE_REQUEST.path('chron-1'))).toBe(true);
    expect(unshareOptions.method).toBe(CHRONICLE_UNSHARE_REQUEST.method);
    expect(screen.queryByRole('button', { name: 'Turn link off' })).not.toBeInTheDocument();
  });

  it('disables both buttons while a request is pending', async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    mockFetchWithAuth.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));

    expect(screen.getByRole('button', { name: 'Share link' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Turn link off' })).toBeDisabled();

    resolveRequest?.({
      ok: true,
      status: 200,
      json: async () => ({ shareToken: 'token-abc' }),
    });

    expect(await screen.findByText('Link copied!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share link' })).not.toBeDisabled();
  });

  it('share 409 shows Write the full chronicle before sharing.', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Write the full chronicle before sharing' }),
    });

    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));

    expect(await screen.findByText('Write the full chronicle before sharing.')).toBeInTheDocument();
  });

  it('share after revoke clears the hidden Turn link off even when the clipboard write fails', async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shareToken: 'token-1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shareEnabled: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shareToken: 'token-2' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ shareEnabled: false }),
      });

    render(<SessionChronicleActions session={sessionWithChronicle} userPlan="pro" />);

    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(await screen.findByText('Link copied!')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn link off' }));
    expect(await screen.findByText('Link turned off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn link off' })).not.toBeInTheDocument();

    writeTextMock.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(
      await screen.findByText(`Copy this link: ${window.location.origin}/chronicle/token-2`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn link off' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Turn link off' }));
    expect(await screen.findByText('Link turned off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn link off' })).not.toBeInTheDocument();

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(4);
    const unshareCalls = mockFetchWithAuth.mock.calls.filter(
      ([url, options]) =>
        (url as string).endsWith(CHRONICLE_UNSHARE_REQUEST.path('chron-1')) &&
        (options as Record<string, unknown>).method === CHRONICLE_UNSHARE_REQUEST.method,
    );
    expect(unshareCalls).toHaveLength(2);
    const [secondUnshareUrl, secondUnshareOptions] = unshareCalls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(secondUnshareUrl.endsWith(CHRONICLE_UNSHARE_REQUEST.path('chron-1'))).toBe(true);
    expect(secondUnshareOptions.method).toBe(CHRONICLE_UNSHARE_REQUEST.method);
    expect(secondUnshareOptions.body).toBeUndefined();
  });
});
