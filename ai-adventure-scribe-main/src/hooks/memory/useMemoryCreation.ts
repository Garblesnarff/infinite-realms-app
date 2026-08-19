import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import type { Memory } from '@/types/memory';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isValidMemoryType } from '@/types/memory';
import { processContent } from '@/utils/memoryClassification';

const MIN_SEGMENT_LENGTH = 50;
// Reduced from 3 to 1 - store only the single most important memory per message
// This dramatically reduces DB writes (from 6/turn to 2/turn) while keeping meaningful data
const MAX_SEGMENTS_PER_MESSAGE = 1;

export const useMemoryCreation = (sessionId: string | null) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const validateMemory = (
    memory: Partial<Memory>,
  ): { isValid: boolean; processedMemory: Partial<Memory> } => {
    const processedMemory = { ...memory };

    if (!memory.content || typeof memory.content !== 'string') {
      logger.error('[Memory Creation] Invalid content:', memory.content);
      return { isValid: false, processedMemory };
    }

    if (typeof memory.type !== 'string' || !isValidMemoryType(memory.type)) {
      logger.error('[Memory Creation] Invalid memory type:', memory.type);
      return { isValid: false, processedMemory };
    }

    // Clamp importance score to valid range (1-5) instead of rejecting
    if (memory.importance && (memory.importance < 1 || memory.importance > 5)) {
      logger.warn(
        '[Memory Creation] Invalid importance score:',
        memory.importance,
        'clamping to valid range',
      );
      processedMemory.importance = Math.max(1, Math.min(5, memory.importance));
    }

    return { isValid: true, processedMemory };
  };

  const createMemory = useMutation({
    mutationFn: async (memory: Omit<Memory, 'id' | 'created_at' | 'updated_at'>) => {
      if (!sessionId) throw new Error('No active session');

      logger.info('[Memory Creation] Starting memory creation process:', memory);

      const validation = validateMemory(memory);
      if (!validation.isValid) {
        throw new Error('Invalid memory data');
      }

      const validatedMemory = validation.processedMemory;

      // The memory is sent as bare content. Embedding it was the browser's job until #1822
      // found that the flag gating it had been off since before the first memory row, so the
      // call this hook used to make had never run in production. The server embeds the row
      // after the insert commits and is the only place that can be held to doing it.
      logger.info('[Memory Creation] Inserting memory into database:', {
        ...validatedMemory,
        session_id: sessionId,
      });

      const [data] = await userDataApi.createMemories([
        {
          ...validatedMemory,
          session_id: sessionId,
          metadata: validatedMemory.metadata || {},
        },
      ]);
      return data;
    },
    onSuccess: (data) => {
      logger.info('[Memory Creation] Memory created successfully');
      // Update cache directly to avoid triggering a refetch on every write.
      // Multiple sequential writes (initial greeting, player + AI per turn) previously
      // each fired invalidateQueries → full re-fetch, causing burst log noise and wasted
      // network calls. setQueryData keeps the cache consistent with zero extra requests.
      const validatedType = isValidMemoryType(data.type) ? data.type : 'general';
      const newMemory: Memory = {
        id: data.id,
        type: validatedType,
        content: data.content,
        importance: data.importance || 0,
        metadata: data.metadata,
        created_at: data.created_at || new Date().toISOString(),
        session_id: data.session_id,
        updated_at: data.updated_at || new Date().toISOString(),
      };
      queryClient.setQueryData<Memory[]>(['memories', sessionId], (old = []) => [
        newMemory,
        ...old,
      ]);
    },
    onError: (error) => {
      logger.error('[Memory Creation] Error in memory creation mutation:', error);
      toast({
        title: 'Error',
        description: 'Failed to create memory: ' + error.message,
        variant: 'destructive',
      });
    },
  });

  const { mutateAsync } = createMemory;

  const extractMemories = useCallback(async (content: string) => {
    try {
      if (!sessionId) throw new Error('No active session');

      logger.info('[Memory Creation] Processing content for memory extraction:', content);

      const memorySegments = processContent(content);
      const filteredSegments: typeof memorySegments = [];
      const seenContent = new Set<string>();

      for (const segment of memorySegments) {
        const normalizedContent = segment.content.trim();
        if (normalizedContent.length < MIN_SEGMENT_LENGTH) {
          logger.debug('[Memory Creation] Skipping short segment:', normalizedContent);
          continue;
        }

        const dedupeKey = normalizedContent.toLowerCase();
        if (seenContent.has(dedupeKey)) {
          logger.debug('[Memory Creation] Skipping duplicate segment:', normalizedContent);
          continue;
        }

        seenContent.add(dedupeKey);
        filteredSegments.push({ ...segment, content: normalizedContent });
      }

      const prioritizedSegments = [...filteredSegments]
        .sort((a, b) => b.importance - a.importance)
        .slice(0, MAX_SEGMENTS_PER_MESSAGE);

      logger.info('[Memory Creation] Classified segments:', prioritizedSegments);

      // Create memories for each classified segment
      for (const segment of prioritizedSegments) {
        if (!isValidMemoryType(segment.type)) {
          logger.warn('[Memory Creation] Skipping segment with invalid type:', segment);
          continue;
        }

        await mutateAsync({
          session_id: sessionId,
          type: segment.type,
          content: segment.content,
          importance: segment.importance,
          metadata: {},
        });
      }

      logger.info('[Memory Creation] Memory extraction completed successfully');
    } catch (error) {
      logger.error('[Memory Creation] Error extracting memories:', error);
      throw error;
    }
  }, [sessionId, mutateAsync]);

  return useMemo(() => ({
    createMemory: createMemory.mutate,
    extractMemories,
  }), [createMemory.mutate, extractMemories]);
};
