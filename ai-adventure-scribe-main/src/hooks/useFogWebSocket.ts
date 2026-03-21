/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-function-return-type */
/**
 * Fog of War WebSocket Hook
 *
 * React hook for real-time fog of war synchronization via WebSocket.
 * Listens for fog:reveal and fog:conceal events from other users.
 *
 * @module hooks/useFogWebSocket
 */

import { useEffect, useRef, useCallback, useState } from 'react';

import type { RevealedArea } from '@/types/fog-of-war';

import logger from '@/lib/logger';

/**
 * Fog WebSocket message types
 */
export interface FogWebSocketMessage {
  type: 'fog:reveal' | 'fog:conceal';
  sceneId: string;
  userId: string;
  timestamp: number;
  data: {
    areas: Array<{
      id: string;
      points: Array<{ x: number; y: number }>;
      isPermanent: boolean;
      revealedAt?: string;
      revealedBy?: string;
    }>;
    userId: string;
  };
}

/**
 * Callbacks for fog updates
 */
export interface FogWebSocketCallbacks {
  onReveal?: (areas: RevealedArea[], userId: string) => void;
  onConceal?: (areas: RevealedArea[], userId: string) => void;
}

/**
 * WebSocket connection options
 */
export interface WebSocketOptions {
  url?: string;
  token?: string;
  sceneId?: string;
  autoConnect?: boolean;
}

/**
 * useFogWebSocket Hook
 *
 * Manages WebSocket connection for real-time fog of war updates.
 * Automatically joins the scene room and listens for fog events.
 *
 * @param options - WebSocket connection options
 * @param callbacks - Event callbacks for fog updates
 * @returns WebSocket state and control functions
 *
 * @example
 * ```tsx
 * const { isConnected, sendReveal, sendConceal } = useFogWebSocket(
 *   { sceneId: 'scene-123', token: authToken },
 *   {
 *     onReveal: (areas, userId) => {
 *       console.log(`User ${userId} revealed areas:`, areas);
 *       // Update local fog state
 *     },
 *     onConceal: (areas, userId) => {
 *       console.log(`User ${userId} concealed areas:`, areas);
 *       // Update local fog state
 *     },
 *   }
 * );
 * ```
 */
export const useFogWebSocket = function(options: WebSocketOptions, callbacks: FogWebSocketCallbacks) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const messageQueueRef = useRef<any[]>([]);

  // Store callbacks in ref to avoid unnecessary re-connections
  const callbacksRef = useRef(callbacks);
  useEffect(function() {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const {
    url = import.meta.env.VITE_WS_URL || 'ws://localhost:8888/ws',
    token,
    sceneId,
    autoConnect = true,
  } = options;

  /**
   * Send a WebSocket message
   */
  const sendMessage = useCallback(function(message: any) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      // Queue message if not connected
      messageQueueRef.current.push(message);
    }
  }, []);

  /**
   * Flush queued messages
   */
  const flushMessageQueue = useCallback(function() {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      while (messageQueueRef.current.length > 0) {
        const message = messageQueueRef.current.shift();
        wsRef.current.send(JSON.stringify(message));
      }
    }
  }, []);

  /**
   * Handle incoming WebSocket messages
   */
  const handleMessage = useCallback(
    function(event: MessageEvent) {
      try {
        const message = JSON.parse(event.data);

        // Handle welcome message
        if (message.type === 'welcome') {
          logger.info('WebSocket connected', { message });
          setIsConnected(true);

          // Join scene room if sceneId provided
          if (sceneId) {
            sendMessage({
              type: 'scene:join',
              sceneId,
              data: {},
            });
          }

          // Flush any queued messages
          flushMessageQueue();
          return;
        }

        // Handle fog reveal
        if (message.type === 'fog:reveal') {
          const fogMessage = message as FogWebSocketMessage;
          if (callbacksRef.current.onReveal && fogMessage.data?.areas) {
            callbacksRef.current.onReveal(fogMessage.data.areas as RevealedArea[], fogMessage.data.userId);
          }
          return;
        }

        // Handle fog conceal
        if (message.type === 'fog:conceal') {
          const fogMessage = message as FogWebSocketMessage;
          if (callbacksRef.current.onConceal && fogMessage.data?.areas) {
            callbacksRef.current.onConceal(fogMessage.data.areas as RevealedArea[], fogMessage.data.userId);
          }
          return;
        }
      } catch (error) {
        logger.error('Error parsing WebSocket message', { error });
      }
    },
    [sceneId, sendMessage, flushMessageQueue],
  );

  /**
   * Connect to WebSocket
   */
  const connect = useCallback(function() {
    if (!token) {
      logger.warn('Cannot connect to WebSocket: no token provided');
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    try {
      const wsUrl = `${url}?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = function onopen() {
        logger.debug('WebSocket opened');
      };

      ws.onmessage = handleMessage;

      ws.onerror = function onerror(error) {
        logger.error('WebSocket error', { error });
      };

      ws.onclose = function onclose() {
        logger.debug('WebSocket closed');
        setIsConnected(false);
        wsRef.current = null;

        // Attempt to reconnect after 3 seconds
        if (autoConnect) {
          reconnectTimeoutRef.current = setTimeout(function() {
            logger.info('Attempting to reconnect WebSocket...');
            connect();
          }, 3000);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      logger.error('Error creating WebSocket', { error });
    }
  }, [url, token, autoConnect, handleMessage]);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(function() {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      // Leave scene before disconnecting
      if (sceneId && wsRef.current.readyState === WebSocket.OPEN) {
        sendMessage({
          type: 'scene:leave',
          sceneId,
          data: {},
        });
      }

      wsRef.current.close();
      wsRef.current = null;
      setIsConnected(false);
    }

    // Clear message queue
    messageQueueRef.current = [];
  }, [sceneId, sendMessage]);

  /**
   * Send fog reveal update
   */
  const sendReveal = useCallback(
    function(areas: RevealedArea[], targetUserId: string) {
      if (!sceneId) return;

      sendMessage({
        type: 'fog:reveal',
        sceneId,
        data: {
          areas,
          userId: targetUserId,
        },
      });
    },
    [sceneId, sendMessage],
  );

  /**
   * Send fog conceal update
   */
  const sendConceal = useCallback(
    function(areas: RevealedArea[], targetUserId: string) {
      if (!sceneId) return;

      sendMessage({
        type: 'fog:conceal',
        sceneId,
        data: {
          areas,
          userId: targetUserId,
        },
      });
    },
    [sceneId, sendMessage],
  );

  // Connect on mount if autoConnect is true
  useEffect(function onmount() {
    if (autoConnect && token) {
      connect();
    }

    return function onunmount() {
      disconnect();
    };
  }, [autoConnect, token, connect, disconnect]);

  return {
    isConnected,
    connect,
    disconnect,
    sendReveal,
    sendConceal,
  };
}
