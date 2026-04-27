/**
 * Foundry VTT Message Handler
 *
 * Handles incoming Foundry VTT specific messages, access verification,
 * and routing to appropriate room broadcasts.
 *
 * Extracted from ws.ts.
 */

import { and, eq } from 'drizzle-orm';

import {
  joinRoom,
  leaveRoom,
  broadcastToRoom,
  getRoomUsers,
  type WSConnection,
  type FoundryMessage
} from './room-manager.js';
import { db } from '../../../../db/client';
import { scenes } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

/**
 * Validate Foundry VTT message structure
 */
export function isValidFoundryMessage(msg: any): msg is FoundryMessage {
  return (
    msg &&
    typeof msg === 'object' &&
    typeof msg.type === 'string' &&
    typeof msg.sceneId === 'string' &&
    msg.sceneId.length > 0
  );
}

/**
 * Verify scene access for a user
 */
export async function verifySceneAccess(userId: string, sceneId: string): Promise<boolean> {
  if (!userId || !sceneId) return false;
  const scene = await db.query.scenes.findFirst({
    where: and(eq(scenes.id, sceneId), eq(scenes.userId, userId)),
    columns: { id: true },
  });
  return Boolean(scene);
}

/**
 * Process Foundry VTT messages
 */
export async function handleFoundryMessage(
  ws: WSConnection,
  msg: FoundryMessage,
  requestId: string
) {
  const { user } = ws.data;
  const allowedScenes = ws.data.allowedScenes ?? new Set<string>();
  ws.data.allowedScenes = allowedScenes;

  if (msg.type === 'scene:join') {
    const hasAccess = await verifySceneAccess(user.userId, msg.sceneId);
    if (!hasAccess) {
      logger.warn({
        requestId,
        sceneId: msg.sceneId,
        userId: user.userId
      }, 'ws.scene_join_denied');
      ws.send(JSON.stringify({
        type: 'error',
        sceneId: msg.sceneId,
        message: 'Access denied to scene',
      }));
      return;
    }
    allowedScenes.add(msg.sceneId);
  } else if (!allowedScenes.has(msg.sceneId)) {
    logger.warn({
      requestId,
      sceneId: msg.sceneId,
      userId: user.userId,
      messageType: msg.type,
    }, 'ws.scene_access_missing');
    ws.send(JSON.stringify({
      type: 'error',
      sceneId: msg.sceneId,
      message: 'Join the scene before sending updates',
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
    case 'scene:join': {
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

      logger.info({
        requestId,
        sceneId: msg.sceneId,
        userId: user.userId,
        usersCount: usersInScene.length
      }, 'ws.scene_join');
      break;
    }

    case 'scene:leave':
      allowedScenes.delete(msg.sceneId);
      // Leave the scene room
      leaveRoom(sceneRoomId, ws);

      // Notify other users in the scene
      broadcastToRoom(sceneRoomId, ws, payload);

      logger.info({
        requestId,
        sceneId: msg.sceneId,
        userId: user.userId
      }, 'ws.scene_leave');
      break;

    case 'token:update':
    case 'token:create':
    case 'token:delete':
    case 'fog:reveal':
    case 'fog:conceal':
    case 'wall:update':
    case 'drawing:create':
    case 'drawing:delete':
      // Broadcast to scene room
      broadcastToRoom(sceneRoomId, ws, payload);

      logger.info({
        requestId,
        sceneId: msg.sceneId,
        userId: user.userId,
        messageType: msg.type,
        dataId: msg.data?.tokenId || msg.data?.wallId || msg.data?.drawingId
      }, 'ws.collaboration_update');
      break;

    default:
      logger.error({
        requestId,
        userId: user.userId,
        messageType: (msg as any).type
      }, 'ws.unknown_message_type');
      break;
  }
}
