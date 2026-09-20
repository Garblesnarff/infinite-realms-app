/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
  mintWsTicket: vi.fn(),
}));

import { useSceneWebSocket } from '../useSceneWebSocket';

// Mock dependencies BEFORE importing the module under test
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

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

import { useAuth } from '@/contexts/AuthContext';

describe('useSceneWebSocket', () => {
  const mockSession = { access_token: 'test-token' };
  const sceneId = 'scene-123';

  // Mock WebSocket
  const originalWebSocket = global.WebSocket;
  let mockWsInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    (useAuth as any).mockReturnValue({ session: mockSession });
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

  it('should initialize and connect on mount', async () => {
    renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    const wsUrl = vi.mocked(global.WebSocket).mock.calls[0][0] as string;
    expect(mocks.mintWsTicket).toHaveBeenCalledWith({ sessionId: `scene:${sceneId}` });
    expect(wsUrl).toContain('/ws?ticket=ws-ticket-1');
    expect(wsUrl).toContain(`sessionId=${encodeURIComponent(`scene:${sceneId}`)}`);
    expect(wsUrl).not.toMatch(/access_token/i);
    expect(wsUrl).not.toMatch(/[?&]token=/i);
    expect(wsUrl).not.toContain(mockSession.access_token);
    expect(mockWsInstance.onopen).toBeDefined();
    expect(mockWsInstance.onmessage).toBeDefined();
    expect(mockWsInstance.onerror).toBeDefined();
    expect(mockWsInstance.onclose).toBeDefined();
  });

  it('should transition to connected state on open and send join message', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionState).toBe('connecting');

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionState).toBe('connected');
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'scene:join', sceneId }),
    );
  });

  it('should handle incoming messages', async () => {
    const onMessage = vi.fn();
    const onTokenUpdate = vi.fn();
    renderHook(() => useSceneWebSocket({ sceneId, onMessage, onTokenUpdate }));
    await flushConnect();

    const testMessage = { type: 'welcome', data: { message: 'hello' } };
    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(testMessage) });
    });

    expect(onMessage).toHaveBeenCalledWith(testMessage);

    const tokenUpdateMessage = {
      type: 'token:update',
      data: { tokenId: 'token-1', positionX: 100, positionY: 100 },
    };
    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(tokenUpdateMessage) });
    });

    expect(onTokenUpdate).toHaveBeenCalledWith(tokenUpdateMessage.data);
  });

  it('should send messages when connection is open', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    const testMsg = { type: 'token:update' as any, data: { foo: 'bar' } };
    act(() => {
      result.current.sendMessage(testMsg);
    });

    expect(mockWsInstance.send).toHaveBeenCalledWith(JSON.stringify(testMsg));
  });

  it('should handle disconnection and auto-reconnect', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    expect(result.current.connectionState).toBe('connected');

    act(() => {
      mockWsInstance.onclose({ code: 1000, reason: 'normal' });
    });

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.isConnected).toBe(false);

    // Should trigger reconnect after delay
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await flushConnect();

    // Second connection attempt
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
    expect(result.current.connectionState).toBe('reconnecting');
  });

  it('should not reconnect if maxReconnectAttempts is reached', async () => {
    renderHook(() => useSceneWebSocket({ sceneId, maxReconnectAttempts: 1 }));
    await flushConnect();

    act(() => {
      mockWsInstance.onclose({ code: 1000 });
    });

    // First reconnect attempt
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await flushConnect();
    expect(global.WebSocket).toHaveBeenCalledTimes(2);

    act(() => {
      mockWsInstance.onclose({ code: 1000 });
    });

    // Should NOT reconnect again
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    await flushConnect();
    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('should handle manual disconnect', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    act(() => {
      result.current.disconnect();
    });

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'scene:leave', sceneId }),
    );
    expect(mockWsInstance.close).toHaveBeenCalled();
    expect(result.current.connectionState).toBe('disconnected');

    // Should NOT auto-reconnect
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(global.WebSocket).toHaveBeenCalledTimes(1);
  });

  it('should handle manual reconnect', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    act(() => {
      result.current.reconnect();
    });

    expect(mockWsInstance.close).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    await flushConnect();

    expect(global.WebSocket).toHaveBeenCalledTimes(2);
  });

  it('should cleanup on unmount', async () => {
    const { unmount } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.readyState = 1; // OPEN
      mockWsInstance.onopen();
    });

    unmount();

    expect(mockWsInstance.close).toHaveBeenCalled();
  });

  it('should handle websocket error', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.onerror(new Error('WS Error'));
    });

    expect(result.current.connectionState).toBe('error');
  });

  it('should handle invalid JSON messages', async () => {
    renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      mockWsInstance.onmessage({ data: 'invalid json' });
    });
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'malformed_ws_frame',
      undefined,
      expect.stringContaining('channel=scene; count=1;'),
    );
  });

  it('should warn when sending message while disconnected', async () => {
    const { result } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    act(() => {
      result.current.sendMessage({ type: 'welcome' });
    });
    // Should log warning
  });

  it('should not connect if missing sceneId', () => {
    renderHook(() => useSceneWebSocket({ sceneId: null }));
    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('should not connect if missing session token', () => {
    (useAuth as any).mockReturnValue({ session: null });
    renderHook(() => useSceneWebSocket({ sceneId }));
    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('should maintain referential stability of returned methods and state when connectionState does not change', async () => {
    const { result, rerender } = renderHook(() => useSceneWebSocket({ sceneId }));
    await flushConnect();

    const firstReturn = result.current;

    // Rerender with the same parameters
    rerender();

    // The reference should be strictly identical
    expect(result.current).toBe(firstReturn);
    expect(result.current.sendMessage).toBe(firstReturn.sendMessage);
    expect(result.current.reconnect).toBe(firstReturn.reconnect);
    expect(result.current.disconnect).toBe(firstReturn.disconnect);
  });
});
