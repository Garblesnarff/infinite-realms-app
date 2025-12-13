/**
 * WebSocket Implementation for Foundry VTT Scene Collaboration
 *
 * Migrated from /server/src/ws.ts to use Elysia's native Bun WebSocket support.
 * Handles room-based messaging, user presence tracking, and real-time collaboration
 * for Foundry VTT scenes.
 */

import { Elysia, t } from 'elysia';
import { verifyWorkOSToken } from './services/workos';

type RoomId = string;

// Custom WebSocket data type with user info
interface WSData {
  user: {
    userId: string;
    email: string;
  };
  roomId: string;
  requestId: string;
}

// Elysia WebSocket wrapper type (simplified for our use case)
interface WSConnection {
  data: WSData;
  send: (message: string | Buffer) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
}

// Maintain our own set of WebSocket connections for room management
// Map of roomId -> Set of WebSocket connections
const rooms = new Map<RoomId, Set<WSConnection>>();

// Foundry VTT message types
type FoundryMessageType =
  | 'scene:join'
  | 'scene:leave'
  | 'token:update'
  | 'token:create'
  | 'token:delete'
  | 'fog:reveal'
  | 'fog:conceal'
  | 'wall:update'
  | 'drawing:create'
  | 'drawing:delete';

interface FoundryMessage {
  type: FoundryMessageType;
  sceneId: string;
  userId: string;
  timestamp: number;
  data: any; // Type-specific payload
}

/**
 * Join a room
 */
function joinRoom(roomId: RoomId, ws: WSConnection) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  rooms.get(roomId)!.add(ws);
}

/**
 * Leave a room
 */
function leaveRoom(roomId: RoomId, ws: WSConnection) {
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    rooms.delete(roomId);
  }
}

/**
 * Broadcast a message to all clients in a room except the sender
 * @param roomId - The room to broadcast to
 * @param sender - The WebSocket that sent the message (will be excluded)
 * @param message - The message object to broadcast
 */
function broadcastToRoom(
  roomId: RoomId,
  sender: WSConnection,
  message: any
) {
  const clients = rooms.get(roomId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    // Only send to connected clients that are not the sender
    // readyState === 1 means OPEN (Bun WebSocket uses numeric states)
    if (client !== sender && client.readyState === 1) {
      client.send(payload);
    }
  }
}

/**
 * Get list of user IDs currently in a room
 * @param roomId - The room to check
 * @returns Array of user IDs
 */
function getRoomUsers(roomId: RoomId): string[] {
  const clients = rooms.get(roomId);
  if (!clients) return [];

  const userIds: string[] = [];
  for (const client of clients) {
    if (client.data?.user?.userId) {
      userIds.push(client.data.user.userId);
    }
  }
  return userIds;
}

/**
 * Broadcast a message to a scene room from server (e.g., from tRPC)
 * This is used when the server needs to broadcast updates from API calls
 * @param sceneId - The scene ID to broadcast to
 * @param message - The message to broadcast
 */
export function broadcastToScene(sceneId: string, message: FoundryMessage) {
  const sceneRoomId = `scene:${sceneId}`;
  const clients = rooms.get(sceneRoomId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    // readyState === 1 means OPEN
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

/**
 * Validate Foundry VTT message structure
 * @param msg - The message to validate
 * @returns true if valid, false otherwise
 */
function isValidFoundryMessage(msg: any): msg is FoundryMessage {
  return (
    msg &&
    typeof msg === 'object' &&
    typeof msg.type === 'string' &&
    typeof msg.sceneId === 'string' &&
    msg.sceneId.length > 0
  );
}

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(ws: WSConnection, rawMessage: string | Buffer) {
  const { user, roomId, requestId } = ws.data;

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

      const clients = rooms.get(roomId);
      if (clients) {
        const payloadStr = JSON.stringify(payload);
        for (const client of clients) {
          if (client.readyState === 1) {
            client.send(payloadStr);
          }
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        msg: 'ws.chat',
        requestId,
        sessionId: roomId,
        userId: user.userId
      }));
      return;
    }

    // Handle Foundry VTT messages
    if (!isValidFoundryMessage(msg)) {
      console.error(JSON.stringify({
        level: 'error',
        msg: 'ws.invalid_message',
        requestId,
        userId: user.userId,
        messageType: msg?.type
      }));
      return;
    }

    const sceneRoomId = `scene:${msg.sceneId}`;
    const timestamp = Date.now();

    // Create response payload with sender info and timestamp
    const payload: FoundryMessage = {
      type: msg.type,
      sceneId: msg.sceneId,
      userId: user.userId,
      timestamp,
      data: msg.data || {},
    };

    // Handle different Foundry VTT message types
    switch (msg.type) {
      case 'scene:join':
        // Join the scene room
        joinRoom(sceneRoomId, ws);

        // Get list of users already in the scene
        const usersInScene = getRoomUsers(sceneRoomId);

        // Send confirmation to the joining user with current users list
        ws.send(JSON.stringify({
          ...payload,
          data: {
            ...payload.data,
            users: usersInScene,
          },
        }));

        // Notify other users in the scene about the new user
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.scene_join',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          usersCount: usersInScene.length
        }));
        break;

      case 'scene:leave':
        // Leave the scene room
        leaveRoom(sceneRoomId, ws);

        // Notify other users in the scene
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.scene_leave',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId
        }));
        break;

      case 'token:update':
        // Broadcast token position/state changes to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.token_update',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          tokenId: msg.data?.tokenId
        }));
        break;

      case 'token:create':
        // Broadcast new token creation to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.token_create',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          tokenId: msg.data?.tokenId
        }));
        break;

      case 'token:delete':
        // Broadcast token deletion to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.token_delete',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          tokenId: msg.data?.tokenId
        }));
        break;

      case 'fog:reveal':
        // Broadcast fog of war reveal to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.fog_reveal',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId
        }));
        break;

      case 'fog:conceal':
        // Broadcast fog of war conceal to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.fog_conceal',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId
        }));
        break;

      case 'wall:update':
        // Broadcast wall/door state changes to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.wall_update',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          wallId: msg.data?.wallId
        }));
        break;

      case 'drawing:create':
        // Broadcast new drawing creation to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.drawing_create',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          drawingId: msg.data?.drawingId
        }));
        break;

      case 'drawing:delete':
        // Broadcast drawing deletion to scene room
        broadcastToRoom(sceneRoomId, ws, payload);

        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.drawing_delete',
          requestId,
          sceneId: msg.sceneId,
          userId: user.userId,
          drawingId: msg.data?.drawingId
        }));
        break;

      default:
        console.error(JSON.stringify({
          level: 'error',
          msg: 'ws.unknown_message_type',
          requestId,
          userId: user.userId,
          messageType: msg.type
        }));
        break;
    }
  } catch (e: any) {
    console.error(JSON.stringify({
      level: 'error',
      msg: 'ws.message_error',
      requestId,
      userId: user.userId,
      error: { message: e?.message, stack: e?.stack }
    }));
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

    console.log(JSON.stringify({
      level: 'info',
      msg: 'ws.scene_cleanup',
      requestId,
      sceneId,
      userId: user.userId
    }));
  }

  console.log(JSON.stringify({
    level: 'info',
    msg: 'ws.close',
    requestId,
    sessionId: roomId,
    userId: user.userId
  }));
}

/**
 * Elysia WebSocket plugin for Foundry VTT collaboration
 */
export const wsPlugin = new Elysia()
  .ws('/ws', {
    // Query parameter validation
    query: t.Object({
      token: t.String(),
      sessionId: t.Optional(t.String()),
      requestId: t.Optional(t.String()),
      rid: t.Optional(t.String()),
    }),
    // Message body can be any JSON
    body: t.Any(),
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

        // Store user data in ws.data
        (ws.data as any).user = user;
        (ws.data as any).roomId = sessionId;
        (ws.data as any).requestId = requestId;

        // Join the session room - cast ws to our connection type
        joinRoom(sessionId, ws as unknown as WSConnection);

        // Log connection
        console.log(JSON.stringify({
          level: 'info',
          msg: 'ws.connection',
          requestId,
          sessionId,
          userId: user.userId
        }));

        // Send welcome message
        ws.send(JSON.stringify({ type: 'welcome', sessionId, requestId }));
      } catch (e: any) {
        const requestId = crypto.randomUUID();
        console.error(JSON.stringify({
          level: 'error',
          msg: 'ws.connection_error',
          requestId,
          error: { message: e?.message, stack: e?.stack }
        }));
        ws.close(4000, 'Unauthorized');
      }
    },
    // Handle incoming messages
    message(ws, message) {
      handleMessage(ws as unknown as WSConnection, message);
    },
    // Handle connection close
    close(ws) {
      handleClose(ws as unknown as WSConnection);
    },
  });
