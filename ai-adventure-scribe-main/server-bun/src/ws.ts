/**
 * WebSocket Implementation for Foundry VTT Scene Collaboration
 *
 * Migrated from /server/src/ws.ts to use Elysia's native Bun WebSocket support.
 * Handles room-based messaging, user presence tracking, and real-time collaboration
 * for Foundry VTT scenes.
 */

import { Elysia, t } from 'elysia';

import { logger } from './lib/logger.js';
import {
  rooms,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  type WSConnection,
  type FoundryMessage,
} from './services/collaboration/room-manager.js';
import { decodeWsFrame } from './services/collaboration/ws-frame.js';
import { consumeWsTicket, WS_UNAUTHORIZED_CLOSE_MS } from './services/ws-ticket.js';

// Re-export for external modules (e.g. tRPC routers)
export { broadcastToScene } from './services/collaboration/room-manager.js';

/**
 * Per-connection message flood control (token bucket).
 *
 * Keyed by the WSConnection object itself (WeakMap) so state is scoped to a
 * single socket and is garbage-collected automatically once the connection
 * is dropped - no explicit cleanup required on close.
 */
const MESSAGE_RATE_LIMIT_CAPACITY = 30; // max messages per window (burst allowance)
const MESSAGE_RATE_LIMIT_WINDOW_MS = 10_000; // window size
const MESSAGE_RATE_LIMIT_ABUSE_VIOLATIONS = 30; // over-budget messages in a window before we hang up

interface MessageRateLimitState {
  tokens: number;
  windowStart: number;
  violations: number;
}

const messageRateLimits = new WeakMap<WSConnection, MessageRateLimitState>();

function checkMessageRateLimit(ws: WSConnection): { allowed: boolean; abusive: boolean } {
  const now = Date.now();
  let state = messageRateLimits.get(ws);

  if (!state || now - state.windowStart >= MESSAGE_RATE_LIMIT_WINDOW_MS) {
    state = { tokens: MESSAGE_RATE_LIMIT_CAPACITY, windowStart: now, violations: 0 };
    messageRateLimits.set(ws, state);
  }

  if (state.tokens > 0) {
    state.tokens -= 1;
    return { allowed: true, abusive: false };
  }

  state.violations += 1;
  return { allowed: false, abusive: state.violations > MESSAGE_RATE_LIMIT_ABUSE_VIOLATIONS };
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(ws: WSConnection, rawMessage: unknown) {
  const { user, roomId, requestId } = ws.data;
  if (!user || !roomId) return;

  // Flood control: cap message throughput per connection before doing any
  // parsing/handling work. Exceeding the burst budget drops the message and
  // sends an error frame; sustained abuse well past the budget closes the
  // socket outright.
  const rateLimit = checkMessageRateLimit(ws);
  if (!rateLimit.allowed) {
    logger.warn(
      { requestId, sessionId: roomId, userId: user.userId, abusive: rateLimit.abusive },
      'ws.rate_limited',
    );

    try {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'Too many messages, please slow down.',
          requestId,
        }),
      );
    } catch {
      // Socket may already be closing; ignore send failures here.
    }

    if (rateLimit.abusive) {
      ws.close(4008, 'Rate limit exceeded');
    }
    return;
  }

  try {
    // Elysia has already deserialized JSON frames for us; decodeWsFrame accepts
    // that object as-is and only parses when the frame is still text or binary.
    // Re-parsing the object here stringified it to "[object Object]" and failed
    // on every message (#1788).
    const msg = decodeWsFrame(rawMessage) as any;

    // Handle legacy chat messages
    if (msg.type === 'chat') {
      const payload = {
        type: 'chat',
        userId: user.userId,
        text: msg.text,
        ts: Date.now(),
        requestId,
      };

      broadcastToRoom(roomId, ws, payload);

      logger.info(
        {
          requestId,
          sessionId: roomId,
          userId: user.userId,
        },
        'ws.chat',
      );
      return;
    }

    // Handle Foundry VTT messages
    const { isValidFoundryMessage, handleFoundryMessage } =
      await import('./services/collaboration/foundry-vtt-handler.js');
    if (!isValidFoundryMessage(msg)) {
      logger.error(
        {
          requestId,
          userId: user.userId,
          messageType: msg?.type,
        },
        'ws.invalid_message',
      );
      return;
    }

    await handleFoundryMessage(ws, msg, requestId);
  } catch (e: any) {
    logger.error(
      {
        requestId,
        userId: user.userId,
        error: { message: e?.message, stack: e?.stack },
      },
      'ws.message_error',
    );
  }
}

/**
 * Handle WebSocket close
 */
function handleClose(ws: WSConnection) {
  const { user, roomId, requestId } = ws.data;
  const authTimer = (ws.data as { authTimer?: ReturnType<typeof setTimeout> }).authTimer;
  if (authTimer) clearTimeout(authTimer);
  if (!user || !roomId) return;

  // Clean up: remove user from session room
  leaveRoom(roomId, ws);

  // Clean up: remove user from all scene rooms they're in
  const sceneRoomsToCleanup: string[] = [];
  for (const [roomId, clients] of rooms.entries()) {
    if (roomId.startsWith('scene:') && clients.has(ws)) {
      sceneRoomsToCleanup.push(roomId);
    }
  }

  // Leave all scene rooms and notify other users
  for (const sceneRoomId of sceneRoomsToCleanup) {
    const sceneId = sceneRoomId.replace('scene:', '');

    // Notify other users in the scene before leaving
    const leavePayload: FoundryMessage = {
      type: 'scene:leave',
      sceneId,
      userId: user.userId,
      timestamp: Date.now(),
      data: { reason: 'disconnect' },
    };
    broadcastToRoom(sceneRoomId, ws, leavePayload);

    // Remove from the scene room
    leaveRoom(sceneRoomId, ws);

    logger.info(
      {
        requestId,
        sceneId,
        userId: user.userId,
      },
      'ws.scene_cleanup',
    );
  }

  logger.info(
    {
      requestId,
      sessionId: roomId,
      userId: user.userId,
    },
    'ws.close',
  );
}

/**
 * Elysia WebSocket plugin for Foundry VTT collaboration
 */
function closeUnauthorized(ws: WsUpgradeSocket): void {
  if (ws.data.authTimer) {
    clearTimeout(ws.data.authTimer);
    ws.data.authTimer = undefined;
  }
  try {
    ws.close(4000, 'Unauthorized');
  } catch {
    // Socket may already be closing.
  }
}

export interface WsUpgradeSocket {
  data: {
    query?: {
      ticket?: string;
      sessionId?: string;
      requestId?: string;
      rid?: string;
    };
    user?: { userId: string; email: string };
    roomId?: string;
    requestId?: string;
    authTimer?: ReturnType<typeof setTimeout>;
  };
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
}

export async function openWsConnection(ws: WsUpgradeSocket): Promise<void> {
  const query = ws.data.query ?? {};
  const queryRid = query.requestId || query.rid;
  const requestId = queryRid || crypto.randomUUID();
  ws.data.requestId = requestId;

  const authTimer = setTimeout(() => closeUnauthorized(ws), WS_UNAUTHORIZED_CLOSE_MS);
  ws.data.authTimer = authTimer;

  try {
    const ticket = query.ticket?.trim();
    if (!ticket) {
      closeUnauthorized(ws);
      return;
    }

    const record = consumeWsTicket(ticket);
    if (!record) {
      closeUnauthorized(ws);
      return;
    }

    const sessionId = record.sessionId || 'lobby';
    const user = { userId: record.userId, email: record.email || '' };
    if (sessionId !== 'lobby') {
      const { verifySessionAccess } = await import('./services/combat/combat-authorization.js');
      await verifySessionAccess(sessionId, user.userId);
    }

    clearTimeout(authTimer);
    ws.data.authTimer = undefined;
    ws.data.user = user;
    ws.data.roomId = sessionId;
    ws.data.requestId = requestId;

    joinRoom(sessionId, ws as unknown as WSConnection);

    logger.info(
      {
        requestId,
        sessionId,
        userId: user.userId,
      },
      'ws.connection',
    );

    ws.send(JSON.stringify({ type: 'welcome', sessionId, requestId }));
  } catch (e: any) {
    logger.error(
      {
        requestId,
        error: { message: e?.message, stack: e?.stack },
      },
      'ws.connection_error',
    );
    closeUnauthorized(ws);
  }
}

export const wsPlugin = new Elysia().ws('/ws', {
  // Query parameter validation. Access tokens are rejected: auth is a
  // one-time ticket minted at POST /v1/ws/ticket.
  query: t.Object({
    ticket: t.Optional(t.String()),
    sessionId: t.Optional(t.String()),
    requestId: t.Optional(t.String()),
    rid: t.Optional(t.String()),
  }),
  // Message body can be any JSON
  body: t.Any(),
  // Cap incoming frame size to prevent memory-exhaustion / flood abuse via
  // oversized WebSocket payloads (Bun default is 16 MB).
  maxPayloadLength: 256 * 1024, // 256 KB
  // Close idle sockets instead of holding them open indefinitely. 960s is
  // Bun/uWebSockets' maximum allowed idleTimeout.
  idleTimeout: 960,
  // Handle new WebSocket connection
  async open(ws) {
    await openWsConnection(ws as unknown as WsUpgradeSocket);
  },
  // Handle incoming messages
  message(ws, message) {
    void handleMessage(ws as unknown as WSConnection, message);
  },
  // Handle connection close
  close(ws) {
    handleClose(ws as unknown as WSConnection);
  },
});
