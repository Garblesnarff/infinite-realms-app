import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback, useEffect, useMemo } from 'react';

import type { ChatMessage, MessageContext } from '@/types/game';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { narrationSegmentsFromPersistedContext } from '@/utils/narration-segments';

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
  messagesReady: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  resetPagination: () => void;
}

export interface UseMessagesOptions {
  /** Poll history while a companion is active and its speech is not pushed by the server. */
  pollForCompanions?: boolean;
}

/**
 * Custom hook for fetching and managing game messages with pagination
 * @param sessionId - Current game session ID
 * @returns Query result containing messages array, loading state, pagination functions
 */
export const useMessages = (
  sessionId: string | null,
  options: UseMessagesOptions = {},
): UseMessagesReturn => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [allMessages, setAllMessages] = useState<ChatMessage[]>([]);
  const [messagesSessionId, setMessagesSessionId] = useState<string | null>(null);

  const query = useQuery<{
    sessionId: string | null;
    page: number;
    messages: ChatMessage[];
    hasMore: boolean;
  }>({
    queryKey: ['messages', sessionId, page],
    queryFn: async () => {
      if (!sessionId) return { sessionId: null, page, messages: [], hasMore: false };

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
        const context = msg.context as MessageContext;
        const rollRequests = Array.isArray(context?.rollRequests)
          ? context.rollRequests
          : Array.isArray(context?.roll_requests)
            ? context.roll_requests
            : undefined;
        const contextSpeakerName =
          typeof context?.speaker_name === 'string' ? context.speaker_name : undefined;

        return {
          text: msg.message,
          sender: msg.speaker_type as ChatMessage['sender'],
          id: msg.id,
          timestamp: msg.timestamp,
          sequenceNumber: typeof msg.sequence_number === 'number' ? msg.sequence_number : undefined,
          context,
          ...(rollRequests ? { rollRequests } : {}),
          narrationSegments: narrationSegmentsFromPersistedContext(context),
          images: Array.isArray(msg.images) ? msg.images : undefined,
          speakerName:
            typeof msg.speaker_name === 'string'
              ? msg.speaker_name
              : contextSpeakerName
                ? contextSpeakerName
                : msg.speaker_type === 'player' && characterData
                  ? characterData.name
                  : undefined,
          characterName:
            msg.speaker_type === 'player' && characterData ? characterData.name : undefined,
          characterAvatar:
            msg.speaker_type === 'player' && characterData
              ? (characterData.avatar_url ?? undefined)
              : undefined,
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

      return { sessionId, page, messages, hasMore: moreAvailable };
    },
    enabled: !!sessionId,
    refetchInterval: options.pollForCompanions ? 5_000 : false,
  });

  // Reset pagination when session changes. Keep the old array tagged to its session until the
  // current session's first page has loaded; consumers receive an empty list in the meantime.
  const resetPagination = useCallback(() => {
    logger.info('[useMessages] Resetting pagination');
    setPage(0);
    setHasMore(true);
    setMessagesSessionId(null);
  }, []);

  useEffect(() => {
    resetPagination();
  }, [sessionId, resetPagination]);

  useEffect(() => {
    const receive = (event: Event) => {
      const rows = (event as CustomEvent<Array<{ id: string; sessionId: string; sequence: number; text: string; timestamp: string; context: MessageContext }>>).detail;
      const received: ChatMessage[] = (rows ?? []).filter((row) => row.sessionId === sessionId).map((row) => ({
        id: row.id, text: row.text, timestamp: row.timestamp, sequenceNumber: row.sequence,
        sender: 'system', context: row.context,
      }));
      if (!received.length) return;
      setAllMessages((previous) => [...previous.filter((message) => !received.some((row) => row.id === message.id)), ...received].sort(compareMessages));
      queryClient.setQueryData<{ messages: ChatMessage[] }>(['messages', sessionId, 0], (previous) => previous ? {
        ...previous, messages: [...previous.messages.filter((message) => !received.some((row) => row.id === message.id)), ...received].sort(compareMessages),
      } : previous);
    };
    window.addEventListener('session-engine-rows', receive);
    return () => window.removeEventListener('session-engine-rows', receive);
  }, [queryClient, sessionId]);

  // Update allMessages whenever query data changes
  useEffect(() => {
    if (query.data?.messages && query.data.sessionId === sessionId && query.data.page === page) {
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
      setMessagesSessionId(sessionId);
      setHasMore(query.data.hasMore);
    }
  }, [query.data, page, sessionId]);

  // Load more messages (next page)
  const loadMore = useCallback(() => {
    if (hasMore && !query.isFetching) {
      logger.info('[useMessages] Loading more messages, current page:', page);
      setPage((prev) => prev + 1);
    }
  }, [hasMore, query.isFetching, page]);

  const messagesReady =
    !!sessionId &&
    page === 0 &&
    !query.isLoading &&
    query.data?.sessionId === sessionId &&
    query.data.page === 0 &&
    messagesSessionId === sessionId;

  return useMemo(
    () => ({
      data: sessionId && messagesSessionId === sessionId ? allMessages : [],
      messagesReady,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      hasMore,
      loadMore,
      resetPagination,
    }),
    [
      allMessages,
      messagesSessionId,
      sessionId,
      messagesReady,
      query.isLoading,
      query.isFetching,
      query.error,
      hasMore,
      loadMore,
      resetPagination,
    ],
  );
};
