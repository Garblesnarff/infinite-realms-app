import { useCallback, useEffect, useRef } from 'react';

import { getAccessToken } from '@/services/auth/TokenService';
import {
  createMalformedPeerFrameReportState,
  reportMalformedPeerFrame,
} from '@/services/websocket-observability';
import { buildSessionStoryWsUrl, mintWsTicket } from '@/services/ws-ticket-client';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
// Consecutive failed attempts (no open) before the hook gives up until remount.
const RECONNECT_MAX_FAILURES = 10;
// An open socket counts as stable, and resets the failure count, only after it stays open this long.
// The server accepts the upgrade and then closes 4000 for a rejected ticket, so an open alone proves nothing.
const STABLE_OPEN_MS = 5_000;

/**
 * Dispatched after the socket reopens (not on the first open). Listeners pull the state the socket
 * may have missed while closed: the character and the authoritative combat board (#1357).
 */
export const SESSION_SOCKET_RECONNECTED_EVENT = 'session-socket-reconnected';

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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let hadStableConnection = false;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = (closeCode?: number): void => {
      failures += 1;
      if (cancelled) return;
      if (failures > RECONNECT_MAX_FAILURES) {
        console.warn(
          `[session-story-socket] giving up after ${RECONNECT_MAX_FAILURES} failed attempts; last close code ${closeCode ?? 'none'}`,
        );
        return;
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** (failures - 1), RECONNECT_MAX_MS);
      retryTimer = setTimeout(() => void connect(), delay);
    };

    const connect = async (): Promise<void> => {
      let socket: WebSocket;
      try {
        const ticket = await mintWsTicket({ sessionId });
        if (cancelled) return;
        socket = new WebSocket(buildSessionStoryWsUrl(ticket, sessionId));
      } catch {
        // Ticket mint failed; retry with backoff.
        scheduleRetry(undefined);
        return;
      }
      socketRef.current = socket;
      socket.onopen = () => {
        if (cancelled) return;
        // Only a socket that stays open is stable. Reset the count and announce the reopen then,
        // so a ticket rejected right after the upgrade cannot loop as if it had recovered.
        stableTimer = setTimeout(() => {
          failures = 0;
          if (hadStableConnection)
            window.dispatchEvent(new CustomEvent(SESSION_SOCKET_RECONNECTED_EVENT));
          hadStableConnection = true;
        }, STABLE_OPEN_MS);
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'chat') {
            if (message.engineRows?.length)
              window.dispatchEvent(
                new CustomEvent('session-engine-rows', { detail: message.engineRows }),
              );
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
            window.dispatchEvent(new CustomEvent('campaign-journal-updated', { detail: message }));
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
          // #130: story appliers (damage, items, XP) write character state
          // out of combat, where no combat_state_updated follows. The server
          // publishes character_state_updated for those writes; it becomes
          // the character-state-updated window event the sheet refreshes on.
          if (message.type === 'character_state_updated') {
            window.dispatchEvent(new CustomEvent('character-state-updated', { detail: message }));
          }
          // #800 item 3: the server persisted a fallback row for a turn the
          // client never saved. The callback refetches the dialogue rows
          // through the normal path (MessageProvider invalidates the
          // messages query on it), and the event lets the live push
          // listener offer the rescued rolls to an empty dice queue.
          if (message.type === 'dm_fallback_persisted') {
            callbackRef.current();
            window.dispatchEvent(new CustomEvent('dm-fallback-persisted', { detail: message }));
          }
        } catch (error) {
          reportMalformedPeerFrame(malformedFrameStateRef.current, {
            channel: 'session-story',
            sessionId: sessionId ?? undefined,
            error,
          });
        }
      };
      socket.onclose = (event) => {
        clearTimeout(stableTimer);
        if (socketRef.current === socket) socketRef.current = null;
        // The cleanup close lands here too; cancelled stops it from reconnecting.
        if (!cancelled) scheduleRetry(event.code);
      };
    };

    void connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      clearTimeout(stableTimer);
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
