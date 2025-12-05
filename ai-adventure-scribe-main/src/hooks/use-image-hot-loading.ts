import { useState, useEffect, useRef, useCallback } from 'react';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { subscriptionManager } from '@/services/supabase-subscription-manager';

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
  currentTime: number = Date.now()
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
 * Custom hook for hot loading background images with realtime updates
 * Uses centralized subscription manager to prevent over-subscription
 * Includes polling fallback for newly created records to handle race conditions
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

  const subscriptionIdRef = useRef<string | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollingStartTimeRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // Callback for realtime updates
  const handleImageUpdate = useCallback((newImageUrl: string | null) => {
    setState((prev) => ({
      ...prev,
      imageUrl: newImageUrl || fallbackImage,
      hasImage: !!newImageUrl,
      isLoading: false,
      error: null,
      pollingActive: false,
    }));

    // Clear polling if active
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      logger.info('Polling stopped: image received via realtime');
    }
  }, [fallbackImage]);

  // Polling function: query Supabase directly
  const pollForImage = useCallback(async () => {
    if (!isMountedRef.current) return;

    try {
      const { data, error } = await supabase
        .from(tableName)
        .select(imageField)
        .eq('id', recordId)
        .single();

      if (error) {
        logger.error(`Polling error for ${tableName} ${recordId}:`, error);
        return;
      }

      const imageUrl = data?.[imageField];

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
      logger.error('Polling fetch failed:', error);
      // Don't stop polling on network errors
    }
  }, [tableName, recordId, imageField]);

  // Start polling if conditions are met
  const startPollingIfNeeded = useCallback((hasImage: boolean) => {
    if (hasImage ||
        pollingIntervalRef.current !== null ||
        !createdAt ||
        !isNewlyCreatedCharacter(createdAt)) {
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
  }, [createdAt, tableName, recordId, pollForImage]);

  useEffect(() => {
    isMountedRef.current = true;

    // Fetch initial image state
    const fetchInitialImage = async () => {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const { data, error } = await supabase
          .from(tableName)
          .select(imageField)
          .eq('id', recordId)
          .single();

        if (error) {
          logger.error(`Error fetching initial ${imageField}:`, error);
          if (isMountedRef.current) {
            setState((prev) => ({
              ...prev,
              error: error.message,
              isLoading: false,
            }));
          }
          return;
        }

        const imageUrl = data?.[imageField];
        const hasImage = !!imageUrl;

        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            imageUrl: imageUrl || fallbackImage,
            hasImage,
            isLoading: !hasImage,
            error: null,
          }));

          // Start polling if needed (for newly created characters without images)
          startPollingIfNeeded(hasImage);
        }
      } catch (err) {
        logger.error('Failed to fetch initial image:', err);
        if (isMountedRef.current) {
          setState((prev) => ({
            ...prev,
            error: 'Failed to load image',
            isLoading: false,
          }));
        }
      }
    };

    // Subscribe to realtime updates via centralized manager
    const subscriptionId = subscriptionManager.subscribe(
      tableName,
      recordId,
      imageField,
      handleImageUpdate,
    );
    subscriptionIdRef.current = subscriptionId;

    // Initialize
    fetchInitialImage();

    // Cleanup function
    return () => {
      isMountedRef.current = false;

      if (subscriptionIdRef.current) {
        subscriptionManager.unsubscribe(tableName, subscriptionIdRef.current);
        subscriptionIdRef.current = null;
      }

      // Clear polling interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [tableName, recordId, imageField, fallbackImage, handleImageUpdate, startPollingIfNeeded]);

  return state;
};

/**
 * Convenience hooks for specific use cases
 */
export const useCampaignImageHotLoading = (
  campaignId: string,
  createdAt?: string
) => {
  return useImageHotLoading({
    tableName: 'campaigns',
    recordId: campaignId,
    imageField: 'background_image',
    fallbackImage: '/campaign-background-placeholder.png',
    createdAt,
  });
};

export const useCharacterImageHotLoading = (
  characterId: string,
  createdAt?: string
) => {
  return useImageHotLoading({
    tableName: 'characters',
    recordId: characterId,
    imageField: 'background_image',
    fallbackImage: '/character-background-placeholder.png',
    createdAt,
  });
};
