import React from 'react';

import { useToast } from '../use-toast';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

/**
 * Hook to manage the ElevenLabs API key lifecycle.
 * Handles fetching from environment or Supabase secrets and providing retries.
 */
export const useVoiceApiKey = () => {
  const { toast } = useToast();
  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const apiKeyRef = React.useRef<string | null>(null);
  const [error, setError] = React.useState<string | undefined>();

  // Update ref when apiKey changes
  React.useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  /**
   * Fetch API key from Supabase secrets or environment
   */
  const fetchApiKey = React.useCallback(async () => {
    try {
      logger.info('🔑 Attempting to retrieve ElevenLabs API key...');

      // Try environment variable first (for development)
      const envApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
      if (envApiKey) {
        logger.info('✅ Using ElevenLabs API key from environment variable');
        setApiKey(envApiKey);
        apiKeyRef.current = envApiKey;
        return;
      }

      logger.info('🔄 No environment variable found, trying Supabase edge function...');

      // Fallback to Supabase edge function (for production)
      const { data, error } = await supabase.functions.invoke('get-secret', {
        body: { secretName: 'ELEVEN_LABS_API_KEY' },
      });

      if (error) {
        logger.error('❌ Error calling get-secret function:', error);
        throw new Error(`Failed to call get-secret: ${error.message}`);
      }

      if (data?.secret) {
        logger.info('✅ Retrieved ElevenLabs API key from Supabase secrets');
        setApiKey(data.secret);
        apiKeyRef.current = data.secret;
      } else {
        logger.error('❌ Empty response from get-secret function:', data);
        throw new Error('ElevenLabs API key is empty or not found');
      }
    } catch (err) {
      logger.error('❌ Error fetching API key for voice:', err);

      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`API Key Error: ${errorMessage}`);

      toast({
        title: 'API Key Configuration Error',
        description: `Failed to retrieve ElevenLabs API key: ${errorMessage}. Check console for details.`,
        variant: 'destructive',
      });
    }
  }, [toast]);

  /**
   * Manual API key retry function
   */
  const retryApiKeyFetch = React.useCallback(async () => {
    logger.info('🔄 Manually retrying API key fetch...');
    setApiKey(null);
    setError(undefined);
    await fetchApiKey();
  }, [fetchApiKey]);

  // Initial fetch on mount
  React.useEffect(() => {
    fetchApiKey();
  }, [fetchApiKey]);

  /**
   * Wait for API key to be available (with timeout)
   */
  const waitForApiKey = React.useCallback(async (timeoutMs: number = 3000): Promise<string | null> => {
    if (apiKeyRef.current) {
        return apiKeyRef.current;
    }

    logger.info('⏳ API key not ready, waiting...');

    const startTime = Date.now();
    const interval = 100;

    while (!apiKeyRef.current && (Date.now() - startTime) < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    if (!apiKeyRef.current) {
      logger.error('❌ API key is still missing after waiting');
      return null;
    }

    logger.info('✅ API key is now available after waiting');
    return apiKeyRef.current;
  }, []);

  return {
    apiKey,
    apiKeyRef,
    error,
    retryApiKeyFetch,
    waitForApiKey,
  };
};
