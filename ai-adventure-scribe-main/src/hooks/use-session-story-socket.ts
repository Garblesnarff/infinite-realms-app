import { useCallback, useEffect, useRef } from 'react';

import { getAccessToken } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export function useSessionStorySocket(sessionId: string | null, onRemoteMessage: () => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const callbackRef = useRef(onRemoteMessage);
  callbackRef.current = onRemoteMessage;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = getAccessToken();
    if (!sessionId || !token) return;
    const base = new URL(API_BASE_URL);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${base.host}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`,
    );
    socketRef.current = socket;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'chat') callbackRef.current();
        if (['map_created', 'entity_moved', 'movement_updated', 'cell_updated', 'map_destroyed'].includes(message.type)) {
          window.dispatchEvent(new CustomEvent('tactical-map-delta', { detail: message }));
        }
        if (message.type === 'combat_state_updated') {
          window.dispatchEvent(new CustomEvent('combat-state-updated', { detail: message }));
          if (message.tacticalMap) {
            window.dispatchEvent(new CustomEvent('tactical-map-delta', {
              detail: { type: 'map_created', map: message.tacticalMap },
            }));
          }
        }
      } catch {
        /* ignore malformed peer frames */
      }
    };
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  return useCallback((text: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'chat', text }));
    }
  }, []);
}
