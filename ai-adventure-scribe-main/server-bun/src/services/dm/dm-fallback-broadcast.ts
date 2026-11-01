/**
 * #800 item 3: push a server-persisted fallback DM row to live tabs.
 *
 * The fallback row exists because the client never saved the turn (#783), so
 * a tab that is already open only learns about it after a reload. The session
 * socket room is the existing channel — the same `broadcastToRoom` path
 * story-broadcast.ts uses for `character_state_updated` — not a new transport.
 * The frame carries ids + roll requests only, never the row prose: the client
 * refetches the row itself through the normal dialogue path, and the live
 * push listener enqueues the requests from the frame.
 *
 * Callers broadcast only after the row write succeeds; a skipped or failed
 * write pushes nothing.
 */
import { broadcastToRoom } from '../collaboration/room-manager.js';

/** The socket message type the client maps to the fallback push handling. */
export const DM_FALLBACK_PERSISTED_MESSAGE = 'dm_fallback_persisted';

export interface DmFallbackBroadcast {
  sessionId: string;
  messageId: string;
  rollRequests: unknown[];
}

export function publishDmFallbackRow(params: DmFallbackBroadcast): void {
  broadcastToRoom(params.sessionId, null, {
    type: DM_FALLBACK_PERSISTED_MESSAGE,
    sessionId: params.sessionId,
    messageId: params.messageId,
    rollRequests: params.rollRequests,
    timestamp: Date.now(),
  });
}
