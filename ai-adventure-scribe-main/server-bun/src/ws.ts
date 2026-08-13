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
  isValidFoundryMessage,
  handleFoundryMessage,
} from './services/collaboration/foundry-vtt-handler.js';
import {
  rooms,
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  type WSConnection,
  type FoundryMessage,
} from './services/collaboration/room-manager.js';
import { verifySessionAccess } from './services/combat/combat-authorization.js';
import { verifyWorkOSToken } from './services/workos.js';

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
async function handleMessage(ws: WSConnection, rawMessage: string | Buffer) {
  const { user, roomId, requestId } = ws.data;

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
    const msg = JSON.parse(rawMessage.toString());

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
export const wsPlugin = new Elysia().ws('/ws', {
  // Query parameter validation
  query: t.Object({
    token: t.String(),
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
    try {
      const query = ws.data.query as any;
      const token = query.token;
      const sessionId = query.sessionId || 'lobby';
      const queryRid = query.requestId || query.rid;
      const requestId = queryRid || crypto.randomUUID();

      if (!token) {
        ws.close(4001, 'Missing token');
        return;
      }

      // Verify WorkOS JWT token
      const user = await verifyWorkOSToken(token);
      if (!user) {
        ws.close(4000, 'Unauthorized');
        return;
      }
      if (sessionId !== 'lobby') {
        await verifySessionAccess(sessionId, user.userId);
      }

      // Store user data in ws.data
      (ws.data as any).user = user;
      (ws.data as any).roomId = sessionId;
      (ws.data as any).requestId = requestId;

      // Join the session room - cast ws to our connection type
      joinRoom(sessionId, ws as unknown as WSConnection);

      // Log connection
      logger.info(
        {
          requestId,
          sessionId,
          userId: user.userId,
        },
        'ws.connection',
      );

      // Send welcome message
      ws.send(JSON.stringify({ type: 'welcome', sessionId, requestId }));
    } catch (e: any) {
      const requestId = crypto.randomUUID();
      logger.error(
        {
          requestId,
          error: { message: e?.message, stack: e?.stack },
        },
        'ws.connection_error',
      );
      ws.close(4000, 'Unauthorized');
    }
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
