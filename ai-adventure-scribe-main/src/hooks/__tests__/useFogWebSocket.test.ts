/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
  mintWsTicket: vi.fn(),
}));

// Mock dependencies BEFORE importing the module under test
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

vi.mock('@/services/ws-ticket-client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, mintWsTicket: mocks.mintWsTicket };
});

import { useFogWebSocket } from '../useFogWebSocket';

describe('useFogWebSocket', () => {
  const url = 'ws://localhost:8888/ws';
  const token = 'test-token';
  const sceneId = 'scene-123';
  const mockCallbacks = {
    onReveal: vi.fn(),
    onConceal: vi.fn(),
  };

  // Mock WebSocket
  const originalWebSocket = global.WebSocket;
  let mockWsInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.mintWsTicket.mockResolvedValue('ws-ticket-1');

    mockWsInstance = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 0, // WebSocket.CONNECTING
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    global.WebSocket = vi.fn(() => mockWsInstance) as any;
    // Set static constants on the mocked WebSocket
    (global.WebSocket as any).CONNECTING = 0;
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CLOSING = 2;
    (global.WebSocket as any).CLOSED = 3;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.useRealTimers();
  });

  async function flushConnect(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('should initialize and connect on mount when token is provided', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    const wsUrl = vi.mocked(global.WebSocket).mock.calls[0][0] as string;
    expect(wsUrl).toBe(`${url}?ticket=ws-ticket-1`);
    expect(wsUrl).not.toMatch(/access_token/i);
    expect(wsUrl).not.toMatch(/[?&]token=/i);
    expect(mockWsInstance.onmessage).toBeDefined();
    expect(mockWsInstance.onclose).toBeDefined();
  });

  it('should not connect if token is missing', () => {
    renderHook(() => useFogWebSocket({ url, sceneId }, mockCallbacks));
    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('should transition to connected state on welcome message', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    expect(result.current.isConnected).toBe(false);

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'welcome' }) });
    });

    expect(result.current.isConnected).toBe(true);
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'scene:join', sceneId, data: {} }),
    );
  });

  it('should handle incoming fog:reveal messages', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    const revealMessage = {
      type: 'fog:reveal',
      data: {
        areas: [{ id: 'area-1', points: [] }],
        userId: 'user-456',
      },
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(revealMessage) });
    });

    expect(mockCallbacks.onReveal).toHaveBeenCalledWith(
      revealMessage.data.areas,
      revealMessage.data.userId,
    );
  });

  it('should handle incoming fog:conceal messages', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    const concealMessage = {
      type: 'fog:conceal',
      data: {
        areas: [{ id: 'area-1', points: [] }],
        userId: 'user-456',
      },
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(concealMessage) });
    });

    expect(mockCallbacks.onConceal).toHaveBeenCalledWith(
      concealMessage.data.areas,
      concealMessage.data.userId,
    );
  });

  it('should queue messages when disconnected and flush on connect', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    const revealData = [{ id: 'area-1', points: [] }] as any;
    act(() => {
      result.current.sendReveal(revealData, 'user-456');
    });

    expect(mockWsInstance.send).not.toHaveBeenCalled();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'welcome' }) });
    });

    // Should have sent scene:join AND the queued reveal message
    expect(mockWsInstance.send).toHaveBeenCalledTimes(2);
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'fog:reveal',
        sceneId,
        data: { areas: revealData, userId: 'user-456' },
      }),
    );
  });

  it('should handle disconnection and auto-reconnect', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'welcome' }) });
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      mockWsInstance.onclose();
    });

    expect(result.current.isConnected).toBe(false);

    // Should attempt to reconnect after 3 seconds
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await flushConnect();

    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('should send leave message and close connection on disconnect', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'welcome' }) });
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'scene:leave', sceneId, data: {} }),
    );
    expect(mockWsInstance.close).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it('should cleanup on unmount', async () => {
    const { unmount } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
    });

    unmount();

    expect(mockWsInstance.close).toHaveBeenCalled();
  });

  it('should send conceal messages', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
    });

    const concealData = [{ id: 'area-1', points: [] }] as any;
    act(() => {
      result.current.sendConceal(concealData, 'user-456');
    });

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'fog:conceal',
        sceneId,
        data: { areas: concealData, userId: 'user-456' },
      }),
    );
  });

  it('should handle WebSocket errors', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.onerror(new Error('WS Error'));
    });

    // Should not throw
  });

  it('should not connect if connect is called without token', () => {
    const { result } = renderHook(() => useFogWebSocket({ url, sceneId }, mockCallbacks));

    act(() => {
      result.current.connect();
    });

    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('should not send reveal/conceal if sceneId is missing', async () => {
    const { result } = renderHook(() => useFogWebSocket({ url, token }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
    });

    act(() => {
      result.current.sendReveal([], 'user-123');
      result.current.sendConceal([], 'user-123');
    });

    expect(mockWsInstance.send).not.toHaveBeenCalled();
  });

  it('should handle invalid JSON messages', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.onmessage({ data: 'invalid json' });
    });
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'malformed_ws_frame',
      undefined,
      expect.stringContaining('channel=fog; count=1;'),
    );
  });

  it('should handle messages with missing data or areas', async () => {
    renderHook(() => useFogWebSocket({ url, token, sceneId }, mockCallbacks));
    await flushConnect();

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'fog:reveal' }) });
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'fog:reveal', data: {} }) });
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'fog:conceal' }) });
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'fog:conceal', data: {} }) });
    });

    expect(mockCallbacks.onReveal).not.toHaveBeenCalled();
    expect(mockCallbacks.onConceal).not.toHaveBeenCalled();
  });

  it('should handle WebSocket onclose without autoConnect', async () => {
    const { result } = renderHook(() =>
      useFogWebSocket({ url, token, sceneId, autoConnect: false }, mockCallbacks),
    );

    // For manual connect since autoConnect is false
    act(() => {
      result.current.connect();
    });
    await flushConnect();

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'welcome' }) });
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      mockWsInstance.onclose();
    });

    expect(result.current.isConnected).toBe(false);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(global.WebSocket).toHaveBeenCalledTimes(1);
  });

  it('should update callbacks without reconnecting', async () => {
    const { rerender } = renderHook(
      ({ callbacks }) => useFogWebSocket({ url, token, sceneId }, callbacks),
      {
        initialProps: { callbacks: mockCallbacks },
      },
    );
    await flushConnect();

    expect(global.WebSocket).toHaveBeenCalledTimes(1);

    const newCallbacks = {
      onReveal: vi.fn(),
      onConceal: vi.fn(),
    };

    rerender({ callbacks: newCallbacks });

    expect(global.WebSocket).toHaveBeenCalledTimes(1);

    const revealMessage = {
      type: 'fog:reveal',
      data: {
        areas: [{ id: 'area-2', points: [] }],
        userId: 'user-789',
      },
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(revealMessage) });
    });

    expect(newCallbacks.onReveal).toHaveBeenCalledWith(
      revealMessage.data.areas,
      revealMessage.data.userId,
    );
    expect(mockCallbacks.onReveal).not.toHaveBeenCalled();
  });

  it('should maintain referential stability of returned methods and state when isConnected does not change', async () => {
    const { result, rerender } = renderHook(
      ({ callbacks }) => useFogWebSocket({ url, token, sceneId }, callbacks),
      {
        initialProps: { callbacks: mockCallbacks },
      },
    );
    await flushConnect();

    const firstReturn = result.current;

    // Rerender with the same parameters
    rerender({ callbacks: mockCallbacks });

    // The reference should be strictly identical
    expect(result.current).toBe(firstReturn);
    expect(result.current.connect).toBe(firstReturn.connect);
    expect(result.current.disconnect).toBe(firstReturn.disconnect);
    expect(result.current.sendReveal).toBe(firstReturn.sendReveal);
    expect(result.current.sendConceal).toBe(firstReturn.sendConceal);
  });
});
