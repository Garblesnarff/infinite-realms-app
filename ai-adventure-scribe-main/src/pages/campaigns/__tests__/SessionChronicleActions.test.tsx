import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHRONICLE_SHARE_REQUEST,
  CHRONICLE_UNSHARE_REQUEST,
} from '../../../../shared/test-fixtures/chronicle-share-wire';
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
  });
});
