import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect, useMemo } from 'react';

import type { ChatMessage, MessageContext } from '@/types/game';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

const PAGE_SIZE = 50;

/**
 * Compare two messages for chronological ordering.
 * Prefers the server-assigned sequence number (monotonic, immune to clock skew and
 * same-millisecond ties) when both messages have one; falls back to ISO timestamp
 * string comparison otherwise. Used to keep `allMessages` strictly chronological
 * regardless of which order pages are loaded in (see #1678).
 */
const compareMessages = (a: ChatMessage, b: ChatMessage): number => {
  if (typeof a.sequenceNumber === 'number' && typeof b.sequenceNumber === 'number') {
    return a.sequenceNumber - b.sequenceNumber;
  }
  return (a.timestamp || '').localeCompare(b.timestamp || '');
};

/**
 * Hook return type definition
 */
export interface UseMessagesReturn {
  data: ChatMessage[];
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  resetPagination: () => void;
  addMessage: (message: ChatMessage) => Promise<void>;
}

/**
 * Custom hook for fetching and managing game messages with pagination
 * @param sessionId - Current game session ID
 * @returns Query result containing messages array, loading state, pagination functions
 */
export const useMessages = (sessionId: string | null): UseMessagesReturn => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);

  const query = useQuery<{ messages: ChatMessage[]; hasMore: boolean }>({
    queryKey: ['messages', sessionId, page],
    queryFn: async () => {
      if (!sessionId) return { messages: [], hasMore: false };

      // Calculate range for pagination
      // For chat interfaces, we want newest messages first when paginating history
      // But we display oldest to newest, so we reverse the query
      const start = page * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      logger.info(`[useMessages] Fetching messages page ${page}, range ${start}-${end}`);

      // Single JOIN query to get messages with character data
      // Order by sequence_number ascending for chronological display (oldest first)
      // Sequence numbers ensure proper ordering even with concurrent multi-tab inserts
      // ⚡ Bolt: Use explicit column list to avoid over-fetching and improve performance.
      const { messages: data, total: count } = await userDataApi.listSessionMessages(
        sessionId,
        start,
        PAGE_SIZE,
      );

      const messages = (data || []).map((msg) => {
        // Extract character data from the nested structure
        // ⚡ Bolt: Using a type cast instead of 'any' to satisfy linting while handling Supabase's
        // deeply nested join results.
        const sessions = msg.game_sessions as unknown as {
          characters: { id: string; name: string; avatar_url: string | null } | null;
        } | null;
        const characterData = sessions?.characters;

        return {
          text: msg.message,
          sender: msg.speaker_type as ChatMessage['sender'],
          id: msg.id,
          timestamp: msg.timestamp,
          sequenceNumber: typeof msg.sequence_number === 'number' ? msg.sequence_number : undefined,
          context: msg.context as MessageContext,
          images: Array.isArray(msg.images) ? msg.images : undefined,
          characterName:
            msg.speaker_type === 'player' && characterData ? characterData.name : undefined,
          characterAvatar:
            msg.speaker_type === 'player' && characterData ? characterData.avatar_url : undefined,
        };
      });

      // Defensive sort to guarantee chronological order (oldest first)
      // Even though DB query uses ascending order, we enforce it client-side
      // as a belt-and-suspenders approach for production reliability
      messages.sort(compareMessages);

      // Messages are now in chronological order (ascending by timestamp)
      // Display oldest at top, newest at bottom

      // Check if there are more messages
      const totalMessages = count || 0;
      const loadedCount = (page + 1) * PAGE_SIZE;
      const moreAvailable = loadedCount < totalMessages;

      logger.info(
        `[useMessages] Loaded ${messages.length} messages, total: ${totalMessages}, hasMore: ${moreAvailable}`,
      );

      return { messages: messages, hasMore: moreAvailable };
    },
    enabled: !!sessionId,
  });

  // Update allMessages whenever query data changes
  useEffect(() => {
    if (query.data?.messages) {
      setAllMessages((prev) => {
        // Initial page load - use messages directly
        if (page === 0) {
          return query.data.messages;
        }
        // Merge the newly loaded page with existing messages, avoiding duplicates.
        // The newly loaded page may be OLDER or NEWER than what's already in state
        // depending on pagination direction (the server returns newest-first pages,
        // so loadMore() fetches progressively older history). Re-sort the combined
        // array so it stays strictly chronological instead of just appending the new
        // page at the end - appending unconditionally caused an older page to be
        // treated as the newest conversation by the prompt's history selector, which
        // walks the array from the end (#1678).
        const existingIds = new Set(prev.map((m) => m.id));
        const newMessages = query.data.messages.filter((m) => !existingIds.has(m.id));
        return [...prev, ...newMessages].sort(compareMessages);
      });
      setHasMore(query.data.hasMore);
    }
  }, [query.data, page]);

  // Load more messages (next page)
  const loadMore = useCallback(() => {
    if (hasMore && !query.isFetching) {
      logger.info('[useMessages] Loading more messages, current page:', page);
      setPage((prev) => prev + 1);
    }
  }, [hasMore, query.isFetching, page]);

  // Reset pagination when session changes
  const resetPagination = useCallback(() => {
    logger.info('[useMessages] Resetting pagination');
    setPage(0);
    setHasMore(true);
    setAllMessages([]);
  }, []);

  // ⚡ Bolt: Automatically reset pagination and clear messages when sessionId changes
  // to prevent stale data leaks between sessions.
  useEffect(() => {
    resetPagination();
  }, [sessionId, resetPagination]);

  // ⚡ Bolt: Wrap addMessage in useCallback to ensure stable identity across renders,
  // preventing unnecessary re-renders of memoized child components that receive this callback.
  const addMessage = useCallback(
    async (message: ChatMessage) => {
      if (!sessionId) return;

      // ⚡ Bolt: Optimistically add the message to the local state for zero-latency UI feedback.
      // This ensures the message appears instantly in the chat list before the DB insert completes.
      setAllMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });

      try {
        const contextData = message.context
          ? {
              location: message.context.location || null,
              emotion: message.context.emotion || null,
              intent: message.context.intent || null,
              handouts: message.context.handouts || null,
            }
          : {};

        await userDataApi.saveSessionMessages(sessionId, {
          id: message.id,
          message: message.text,
          speaker_type: message.sender,
          context: contextData,
          timestamp: new Date().toISOString(),
        });

        // Invalidate all message queries to refetch and sync with DB sequence numbers
        await queryClient.invalidateQueries({ queryKey: ['messages', sessionId] });
      } catch (error) {
        // ⚡ Bolt: Rollback optimistic update on error to keep UI in sync with source of truth
        setAllMessages((prev) => prev.filter((m) => m.id !== message.id));
        logger.error('Failed to add message:', error);
        throw error;
      }
    },
    [sessionId, queryClient],
  );

  return useMemo(
    () => ({
      data: allMessages,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      hasMore,
      loadMore,
      resetPagination,
      addMessage,
    }),
    [
      allMessages,
      query.isLoading,
      query.isFetching,
      query.error,
      hasMore,
      loadMore,
      resetPagination,
      addMessage,
    ],
  );
};
