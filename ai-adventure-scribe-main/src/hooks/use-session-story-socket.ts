import { useCallback, useEffect, useRef } from 'react';

import { getAccessToken } from '@/services/auth/TokenService';
import {
  createMalformedPeerFrameReportState,
  reportMalformedPeerFrame,
} from '@/services/websocket-observability';
import { buildSessionStoryWsUrl, mintWsTicket } from '@/services/ws-ticket-client';

export function useSessionStorySocket(sessionId: string | null, onRemoteMessage: () => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const malformedFrameStateRef = useRef(createMalformedPeerFrameReportState());
  const callbackRef = useRef(onRemoteMessage);
  callbackRef.current = onRemoteMessage;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = getAccessToken();
    if (!sessionId || !token) return;
    let cancelled = false;

    void (async () => {
      try {
        const ticket = await mintWsTicket({ sessionId });
        if (cancelled) return;
        const socket = new WebSocket(buildSessionStoryWsUrl(ticket, sessionId));
        socketRef.current = socket;
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data));
            if (message.type === 'chat') {
              if (message.engineRows?.length) window.dispatchEvent(new CustomEvent('session-engine-rows', { detail: message.engineRows }));
              else callbackRef.current();
            }
            if (
              [
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
              ].includes(message.type)
            ) {
              window.dispatchEvent(new CustomEvent('tactical-map-delta', { detail: message }));
            }
            if (['handout_delivered', 'handout_degraded'].includes(message.type)) {
              window.dispatchEvent(
                new CustomEvent('campaign-journal-updated', { detail: message }),
              );
            }
            if (message.type === 'combat_state_updated') {
              window.dispatchEvent(new CustomEvent('combat-state-updated', { detail: message }));
              if (message.tacticalMap) {
                window.dispatchEvent(
                  new CustomEvent('tactical-map-delta', {
                    detail: { type: 'map_created', map: message.tacticalMap },
                  }),
                );
              }
            }
          } catch (error) {
            reportMalformedPeerFrame(malformedFrameStateRef.current, {
              channel: 'session-story',
              sessionId: sessionId ?? undefined,
              error,
            });
          }
        };
      } catch {
        // Ticket mint failed; the socket is never opened.
      }
    })();

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  return useCallback((text: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'chat', text }));
    }
  }, []);
}
