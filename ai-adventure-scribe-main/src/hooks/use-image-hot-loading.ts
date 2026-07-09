import { useState, useEffect, useRef, useCallback } from 'react';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Polling configuration constants
const POLLING_INTERVAL_MS = 2000; // 2 seconds
const POLLING_TIMEOUT_MS = 30000; // 30 seconds
const NEW_CHARACTER_WINDOW_MS = 60000; // 60 seconds

interface UseImageHotLoadingOptions {
  tableName: 'campaigns' | 'characters';
  recordId: string;
  imageField?: string;
  fallbackImage?: string;
  createdAt?: string;
}

interface ImageHotLoadingState {
  imageUrl: string;
  isLoading: boolean;
  hasImage: boolean;
  error: string | null;
  pollingActive?: boolean;
}

/**
 * Helper function to detect newly created characters/campaigns
 * Returns true if the record was created within the last 60 seconds
 */
function isNewlyCreatedCharacter(
  createdAt: string | undefined,
  currentTime: number = Date.now(),
): boolean {
  if (!createdAt) return false;

  try {
    const createdTime = new Date(createdAt).getTime();
    if (isNaN(createdTime)) {
      logger.warn('Invalid created_at timestamp, skipping polling');
      return false;
    }

    const ageMs = currentTime - createdTime;

    // Handle clock skew: reject if > 5 seconds in future
    if (ageMs < -5000) {
      logger.warn('created_at is in future, possible clock skew');
      return false;
    }

    return ageMs >= 0 && ageMs <= NEW_CHARACTER_WINDOW_MS;
  } catch (error) {
    logger.error('Error checking character age:', error);
    return false;
  }
}

/**
 * Fetch a record through server-bun (campaigns/characters have no direct
 * anon/authenticated grants — RLS is locked down with zero policies, so this
 * must go through the backend, not supabase-js).
 */
async function fetchRecordImage(
  tableName: 'campaigns' | 'characters',
  recordId: string,
  imageField: string,
): Promise<string | null> {
  const record =
    tableName === 'campaigns'
      ? await userDataApi.getCampaign(recordId)
      : await userDataApi.getCharacter(recordId);

  return record?.[imageField] ?? null;
}

/**
 * Custom hook for hot loading background images, with polling fallback for
 * newly created records to handle race conditions while an image generates.
 *
 * Note: this used to also subscribe to Supabase Realtime postgres_changes,
 * but that requires the same RLS policies as direct table access, which were
 * intentionally revoked for campaigns/characters. Polling is now the only
 * update mechanism.
 */
export const useImageHotLoading = ({
  tableName,
  recordId,
  imageField = 'background_image',
  fallbackImage = '/card-placeholder.svg',
  createdAt,
}: UseImageHotLoadingOptions): ImageHotLoadingState => {
  const [state, setState] = useState<ImageHotLoadingState>({
    imageUrl: fallbackImage,
    isLoading: true,
    hasImage: false,
    error: null,
    pollingActive: false,
  });

  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // Polling function: fetch the record through server-bun
  const pollForImage = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      const imageUrl = await fetchRecordImage(tableName, recordId, imageField);

      if (imageUrl && isMountedRef.current) {
        logger.info(`Polling success: image found for ${tableName} ${recordId}`);
        setState((prev) => ({
          ...prev,
          imageUrl,
          hasImage: true,
          isLoading: false,
          pollingActive: false,
        }));

        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } catch (error) {
      logger.error(`Polling error for ${tableName} ${recordId}:`, error);
      // Don't stop polling on network errors
    }
  }, [tableName, recordId, imageField]);

  // Start polling if conditions are met
  const startPollingIfNeeded = useCallback(
    (hasImage: boolean) => {
      if (
        hasImage ||
        pollingIntervalRef.current !== null ||
        !createdAt ||
        !isNewlyCreatedCharacter(createdAt)
      ) {
        return;
      }

      logger.info(`Starting polling for ${tableName} ${recordId}`);
      pollingStartTimeRef.current = Date.now();

      setState((prev) => ({ ...prev, pollingActive: true }));

      pollingIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - (pollingStartTimeRef.current || 0);

        if (elapsed >= POLLING_TIMEOUT_MS) {
          logger.info(`Polling timeout reached for ${tableName} ${recordId}`);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setState((prev) => ({
            ...prev,
            isLoading: false,
            pollingActive: false,
          }));
          return;
        }

        pollForImage();
      }, POLLING_INTERVAL_MS);

      // Immediate first poll
      pollForImage();
    },
    [createdAt, tableName, recordId, pollForImage],
  );

  useEffect(() => {
    isMountedRef.current = true;

    // Fetch initial image state
    const fetchInitialImage = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const imageUrl = await fetchRecordImage(tableName, recordId, imageField);
        const hasImage = !!imageUrl;

        if (isMountedRef.current) {
          const newlyCreated = isNewlyCreatedCharacter(createdAt);
          const shouldPoll = !hasImage && newlyCreated;

          setState((prev) => ({
            ...prev,
            imageUrl: imageUrl || fallbackImage,
            hasImage,
            isLoading: shouldPoll,
            error: null,
          }));

          // Start polling if needed (for newly created characters without images)
          startPollingIfNeeded(hasImage);
        }
      } catch (err) {
        logger.error(`Error fetching initial ${imageField}:`, err);
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : 'Failed to load image',
            isLoading: false,
          }));
        }
      }
    };

    fetchInitialImage();

    // Cleanup function
    return () => {
      isMountedRef.current = false;

      // Clear polling interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [tableName, recordId, imageField, fallbackImage, startPollingIfNeeded]);

  return state;
};

/**
 * Convenience hooks for specific use cases
 */
export const useCampaignImageHotLoading = (campaignId: string, createdAt?: string) => {
  return useImageHotLoading({
    tableName: 'campaigns',
    recordId: campaignId,
    imageField: 'background_image',
    fallbackImage: '/campaign-background-placeholder.png',
    createdAt,
  });
};

export const useCharacterImageHotLoading = (characterId: string, createdAt?: string) => {
  return useImageHotLoading({
    tableName: 'characters',
    recordId: characterId,
    imageField: 'background_image',
    fallbackImage: '/character-background-placeholder.png',
    createdAt,
  });
};
