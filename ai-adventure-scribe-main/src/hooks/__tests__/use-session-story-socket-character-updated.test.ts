/**
 * #130: verifies that `use-session-story-socket` dispatches the
 * `character-state-updated` window event when the server sends a
 * `character_updated` socket message (after story damage/items are applied).
 *
 * Real: the socket message handler and window event dispatch.
 * Stubbed: WebSocket (captures the onmessage handler), ws ticket minting.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useSessionStorySocket } from '../use-session-story-socket';

vi.mock('@/services/auth/TokenService', () => ({
  getAccessToken: vi.fn(() => 'test-token'),
}));
vi.mock('@/services/ws-ticket-client', () => ({
  buildSessionStoryWsUrl: vi.fn(() => 'ws://test/session'),
  mintWsTicket: vi.fn(() => Promise.resolve('ticket-123')),
}));
vi.mock('@/services/websocket-observability', () => ({
  createMalformedPeerFrameReportState: vi.fn(() => ({})),
  reportMalformedPeerFrame: vi.fn(),
}));

describe('#130 use-session-story-socket dispatches character-state-updated', () => {
  let mockSocket: {
    onmessage: ((event: { data: string }) => void) | null;
    close: () => void;
    readyState: number;
    send: (data: string) => void;
  };
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    mockSocket = {
      onmessage: null,
      close: vi.fn(),
      readyState: 1,
      send: vi.fn(),
    };
    originalWebSocket = global.WebSocket;
    // @ts-expect-error - mock WebSocket
    global.WebSocket = vi.fn(() => mockSocket);
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  it('dispatches character-state-updated on character_updated message', async () => {
    const onRemoteMessage = vi.fn();
    const eventListener = vi.fn();
    window.addEventListener('character-state-updated', eventListener);

    renderHook(() => useSessionStorySocket('session-123', onRemoteMessage));

    // Wait for the socket to be created
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(mockSocket.onmessage).not.toBeNull();

    // Simulate the server sending character_updated after story damage
    await act(async () => {
      mockSocket.onmessage!({
        data: JSON.stringify({ type: 'character_updated', characterId: 'char-123' }),
      });
    });

    expect(eventListener).toHaveBeenCalledTimes(1);
    const event = eventListener.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ type: 'character_updated', characterId: 'char-123' });

    window.removeEventListener('character-state-updated', eventListener);
  });

  it('does not dispatch for other message types', async () => {
    const onRemoteMessage = vi.fn();
    const eventListener = vi.fn();
    window.addEventListener('character-state-updated', eventListener);

    renderHook(() => useSessionStorySocket('session-123', onRemoteMessage));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await act(async () => {
      mockSocket.onmessage!({
        data: JSON.stringify({ type: 'chat', text: 'hello' }),
      });
    });

    expect(eventListener).not.toHaveBeenCalled();
    window.removeEventListener('character-state-updated', eventListener);
  });
});
