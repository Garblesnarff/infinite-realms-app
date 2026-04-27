/**
 * Collaboration Room Manager
 *
 * Handles room-based messaging, user presence tracking, and broadcasting
 * for real-time collaboration.
 *
 * Extracted from ws.ts.
 */

export type RoomId = string;

// Custom WebSocket data type with user info
export interface WSData {
  user: {
    userId: string;
    email: string;
  };
  roomId: string;
  requestId: string;
  allowedScenes?: Set<string>;
}

// Elysia WebSocket wrapper type
export interface WSConnection {
  data: WSData;
  send: (message: string | Buffer) => void;
  close: (code?: number, reason?: string) => void;
  readyState: number;
}

/**
 * Foundry VTT message types
 */
export type FoundryMessageType =
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

export interface FoundryMessage {
  type: FoundryMessageType;
  sceneId: string;
  userId: string;
  timestamp: number;
  data: any; // Type-specific payload
}

// Maintain our own set of WebSocket connections for room management
// Map of roomId -> Set of WebSocket connections
export const rooms = new Map<RoomId, Set<WSConnection>>();

/**
 * Join a room
 */
export function joinRoom(roomId: RoomId, ws: WSConnection) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  rooms.get(roomId)!.add(ws);
}

/**
 * Leave a room
 */
export function leaveRoom(roomId: RoomId, ws: WSConnection) {
  const set = rooms.get(roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    rooms.delete(roomId);
  }
}

/**
 * Broadcast a message to all clients in a room except the sender
 */
export function broadcastToRoom(
  roomId: RoomId,
  sender: WSConnection,
  message: any
) {
  const clients = rooms.get(roomId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    // Only send to connected clients that are not the sender
    // readyState === 1 means OPEN
    if (client !== sender && client.readyState === 1) {
      client.send(payload);
    }
  }
}

/**
 * Get list of user IDs currently in a room
 */
export function getRoomUsers(roomId: RoomId): string[] {
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
 * Broadcast a message to a scene room from server
 */
export function broadcastToScene(sceneId: string, message: FoundryMessage) {
  const sceneRoomId = `scene:${sceneId}`;
  const clients = rooms.get(sceneRoomId);
  if (!clients) return;

  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}
