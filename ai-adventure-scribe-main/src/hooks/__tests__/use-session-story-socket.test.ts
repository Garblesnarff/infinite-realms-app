/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getAccessToken } from '@/services/auth/TokenService';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
  warn: vi.fn(),
  mintWsTicket: vi.fn(),
}));

vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    getAccessToken: vi.fn(),
  }),
);

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: mocks.warn },
}));

vi.mock('@/services/ws-ticket-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, mintWsTicket: mocks.mintWsTicket };
});

describe('useSessionStorySocket', () => {
  const sessionId = 'test-session-123';
  const mockToken = 'mock-access-token';
  const originalWebSocket = global.WebSocket;
  let mockWsInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.mocked(getAccessToken).mockReturnValue(mockToken);
    mocks.mintWsTicket.mockResolvedValue('ws-ticket-1');

    mockWsInstance = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: 0, // WebSocket.CONNECTING
      onmessage: null,
    };

    global.WebSocket = vi.fn(() => mockWsInstance) as any;
    (global.WebSocket as any).CONNECTING = 0;
    (global.WebSocket as any).OPEN = 1;
    (global.WebSocket as any).CLOSING = 2;
    (global.WebSocket as any).CLOSED = 3;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
    vi.unstubAllEnvs();
  });

  it('should not initialize WebSocket if sessionId is null', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(null, () => {}));
    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  it('should not initialize WebSocket if token is missing', async () => {
    vi.mocked(getAccessToken).mockReturnValue(null);
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    expect(global.WebSocket).not.toHaveBeenCalled();
    expect(mocks.mintWsTicket).not.toHaveBeenCalled();
  });

  it('should initialize WebSocket with a ticket and never put token in the URL', async () => {
    vi.stubEnv('VITE_API_URL', 'http://localhost:8888');
    const { useSessionStorySocket } = await import('../use-session-story-socket');

    renderHook(() => useSessionStorySocket(sessionId, () => {}));

    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const url = vi.mocked(global.WebSocket).mock.calls[0][0] as string;
    expect(url).toBe(
      `ws://localhost:8888/ws?ticket=ws-ticket-1&sessionId=${encodeURIComponent(sessionId)}`,
    );
    expect(url).not.toMatch(/access_token/i);
    expect(url).not.toMatch(/[?&]token=/i);
    expect(url).not.toContain(mockToken);
  });

  it('should initialize WebSocket with wss and a ticket for https API URL', async () => {
    vi.stubEnv('VITE_API_URL', 'https://api.infiniterealms.app');
    const { useSessionStorySocket } = await import('../use-session-story-socket');

    renderHook(() => useSessionStorySocket(sessionId, () => {}));

    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());
    const url = vi.mocked(global.WebSocket).mock.calls[0][0] as string;
    expect(url).toBe(
      `wss://api.infiniterealms.app/ws?ticket=ws-ticket-1&sessionId=${encodeURIComponent(sessionId)}`,
    );
    expect(url).not.toMatch(/access_token/i);
    expect(url).not.toMatch(/[?&]token=/i);
  });

  it('should execute onRemoteMessage callback when a chat message is received', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    const onRemoteMessage = vi.fn();
    renderHook(() => useSessionStorySocket(sessionId, onRemoteMessage));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify({ type: 'chat', text: 'hello' }) });
    });

    expect(onRemoteMessage).toHaveBeenCalledTimes(1);
  });

  it('should dispatch tactical-map-delta custom event when tactical map messages are received', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    const tacticalTypes = [
      'map_created',
      'entity_moved',
      'entity_placed',
      'entity_removed',
      'movement_updated',
      'cell_updated',
      'map_destroyed',
      'tactical_action_queue',
      'tactical_degraded',
      'aoe_preview',
      'aoe_cast',
    ];

    tacticalTypes.forEach((type) => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const payload = { type, foo: 'bar' };

      act(() => {
        mockWsInstance.onmessage({ data: JSON.stringify(payload) });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'tactical-map-delta',
          detail: payload,
        }),
      );
      dispatchSpy.mockRestore();
    });
  });

  it('should dispatch campaign-journal-updated custom event when handout messages are received', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    const handoutTypes = ['handout_delivered', 'handout_degraded'];

    handoutTypes.forEach((type) => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      const payload = { type, id: 'handout-1' };

      act(() => {
        mockWsInstance.onmessage({ data: JSON.stringify(payload) });
      });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'campaign-journal-updated',
          detail: payload,
        }),
      );
      dispatchSpy.mockRestore();
    });
  });

  it('should dispatch combat-state-updated and map_created events on combat_state_updated with tacticalMap', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const payload = {
      type: 'combat_state_updated',
      combatState: { active: true },
      tacticalMap: { id: 'map-1' },
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(payload) });
    });

    // First, combat-state-updated should be dispatched
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'combat-state-updated',
        detail: payload,
      }),
    );

    // Second, map_created should be dispatched since tacticalMap was included
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tactical-map-delta',
        detail: { type: 'map_created', map: { id: 'map-1' } },
      }),
    );

    dispatchSpy.mockRestore();
  });

  it('should dispatch only combat-state-updated when combat_state_updated is received without tacticalMap', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const payload = {
      type: 'combat_state_updated',
      combatState: { active: true },
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(payload) });
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'combat-state-updated',
        detail: payload,
      }),
    );

    dispatchSpy.mockRestore();
  });

  it('should handle and ignore malformed JSON message frames without throwing', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    expect(() => {
      act(() => {
        mockWsInstance.onmessage({ data: 'this-is-not-json' });
      });
    }).not.toThrow();

    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'malformed_ws_frame',
      sessionId,
      expect.stringContaining('channel=session-story; count=1;'),
    );
  });

  it('should return a function to send chat messages and send if socket is open', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    const { result } = renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    // Before OPEN state
    mockWsInstance.readyState = 0; // CONNECTING
    act(() => {
      result.current('hello server');
    });
    expect(mockWsInstance.send).not.toHaveBeenCalled();

    // In OPEN state
    mockWsInstance.readyState = 1; // OPEN
    act(() => {
      result.current('hello server');
    });
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat', text: 'hello server' }),
    );
  });

  it('should close WebSocket connection on unmount', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    const { unmount } = renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await waitFor(() => expect(global.WebSocket).toHaveBeenCalled());

    unmount();

    expect(mockWsInstance.close).toHaveBeenCalledTimes(1);
  });

  it('should refetch and dispatch dm-fallback-persisted when a fallback frame arrives (#800 item 3)', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    const onRemoteMessage = vi.fn();
    renderHook(() => useSessionStorySocket(sessionId, onRemoteMessage));
    await waitFor(() => expect(mockWsInstance.onmessage).toBeTruthy());

    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const payload = {
      type: 'dm_fallback_persisted',
      sessionId,
      messageId: 'dm-1',
      rollRequests: [{ type: 'check', purpose: 'Search the room' }],
    };

    act(() => {
      mockWsInstance.onmessage({ data: JSON.stringify(payload) });
    });

    expect(onRemoteMessage).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dm-fallback-persisted',
        detail: payload,
      }),
    );
    dispatchSpy.mockRestore();
  });
});

describe('useSessionStorySocket reconnect (#1357)', () => {
  const sessionId = 'test-session-reconnect';

  class FakeSocket {
    static OPEN = 1;
    static instances: FakeSocket[] = [];
    readyState = 0;
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    send = vi.fn();
    // A browser fires onclose when close() is called; the hook must ignore that on cleanup.
    close = vi.fn(() => {
      this.readyState = 3;
      this.onclose?.({ code: 1000 });
    });

    constructor(readonly url: string) {
      FakeSocket.instances.push(this);
    }

    open(): void {
      this.readyState = 1;
      this.onopen?.({});
    }

    drop(code = 1006): void {
      this.readyState = 3;
      this.onclose?.({ code });
    }
  }

  const originalWebSocket = global.WebSocket;

  async function flush(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeSocket.instances = [];
    global.WebSocket = FakeSocket as unknown as typeof WebSocket;
    vi.mocked(getAccessToken).mockReturnValue('mock-access-token');
    mocks.mintWsTicket.mockReset();
    mocks.mintWsTicket.mockResolvedValue('ws-ticket-1');
  });

  afterEach(() => {
    vi.useRealTimers();
    global.WebSocket = originalWebSocket;
  });

  it('opens a new socket with a fresh ticket after an unexpected close', async () => {
    mocks.mintWsTicket.mockResolvedValueOnce('ticket-1').mockResolvedValueOnce('ticket-2');
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await flush();
    expect(FakeSocket.instances).toHaveLength(1);

    FakeSocket.instances[0].open();
    FakeSocket.instances[0].drop(1006);

    await advance(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await advance(1);
    await flush();

    expect(FakeSocket.instances).toHaveLength(2);
    expect(mocks.mintWsTicket).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances[1].url).toContain('ticket=ticket-2');
  });

  it('backs off 1 s, 2 s, 4 s and caps the wait at 30 s', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await flush();

    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [index, delay] of delays.entries()) {
      FakeSocket.instances[index].drop(1006);
      await advance(delay - 1);
      expect(FakeSocket.instances).toHaveLength(index + 1);
      await advance(1);
      await flush();
      expect(FakeSocket.instances).toHaveLength(index + 2);
    }
  });

  it('stops retrying after the failure cap', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await flush();

    for (let i = 0; i < 15; i++) {
      FakeSocket.instances[FakeSocket.instances.length - 1].drop(4000);
      await advance(30_000);
      await flush();
    }

    // One initial socket plus ten retries, then the hook gives up.
    expect(FakeSocket.instances).toHaveLength(11);
  });

  it('does not reconnect after the cleanup close on unmount', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    const { unmount } = renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await flush();
    FakeSocket.instances[0].open();

    unmount();
    await advance(60_000);
    await flush();

    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('dispatches session-socket-reconnected once per reconnect, not on the first open', async () => {
    const { useSessionStorySocket } = await import('../use-session-story-socket');
    renderHook(() => useSessionStorySocket(sessionId, () => {}));
    await flush();
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    const reconnectEvents = (): number =>
      dispatchSpy.mock.calls.filter(
        ([event]) => (event as Event).type === 'session-socket-reconnected',
      ).length;

    FakeSocket.instances[0].open();
    expect(reconnectEvents()).toBe(0);

    FakeSocket.instances[0].drop(1006);
    await advance(1000);
    await flush();
    FakeSocket.instances[1].open();

    expect(reconnectEvents()).toBe(1);
    dispatchSpy.mockRestore();
  });
});
