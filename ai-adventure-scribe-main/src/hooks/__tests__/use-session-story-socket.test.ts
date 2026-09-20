/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getAccessToken } from '@/services/auth/TokenService';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
  warn: vi.fn(),
  mintWsTicket: vi.fn(),
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAccessToken: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: mocks.warn },
}));

vi.mock('@/services/ws-ticket-client', async (importOriginal) => {
  const actual = await importOriginal();
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
});
