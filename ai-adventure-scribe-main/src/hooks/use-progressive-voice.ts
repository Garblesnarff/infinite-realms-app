/* eslint-disable max-lines */
/**
 * Progressive Voice Hook
 *
 * Simplified voice synthesis with progressive audio generation and playback.
 * Replaces the complex useMultiVoice hook with a cleaner, more reliable approach.
 *
 * Key features:
 * - Progressive generation: Generate and play audio segments one at a time
 * - Single processing path: No complex parsing, just AI segments -> VoiceDirector -> Audio
 * - Robust fallbacks: Every step has error recovery
 * - Fast feedback: Audio starts playing immediately
 *
 * @author AI Dungeon Master Team
 */

import React from 'react';

import { useLocalStorage } from './use-local-storage';
import { useToast } from './use-toast';
import { useVoiceAudioControl } from './use-voice-audio-control';
import { logger } from '../lib/logger';

import type { VoiceSegment, AISegment } from '@/services/voice-routing';

import { supabase } from '@/integrations/supabase/client';
import { VoiceDirector } from '@/services/voice-director';

export interface ProgressiveVoiceState {
  segments: VoiceSegment[];
  currentSegmentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  isProcessing: boolean;
  volume: number;
  isMuted: boolean;
  isVoiceEnabled: boolean;
  error?: string;
}

export const useProgressiveVoice = () => {
  const { toast } = useToast();

  // Persistent settings with type-safe localStorage hooks
  const [isVoiceEnabled, setIsVoiceEnabled] = useLocalStorage<boolean>(
    'progressive-voice-enabled',
    true,
  );

  /**
   * Initialize Audio Control Hook
   */
  const {
    volume,
    isMuted,
    currentAudio,
    initializeAudioContext,
    playAudioSegment,
    pausePlayback: basePausePlayback,
    resumePlayback: baseResumePlayback,
    stopPlayback: baseStopPlayback,
    handleSetVolume,
    toggleMute: baseToggleMute,
  } = useVoiceAudioControl({
    onSegmentStart: (index) => {
      setState((prev) => ({
        ...prev,
        currentSegmentIndex: index,
        segments: prev.segments.map((s, idx) => ({
          ...s,
          isPlaying: idx === index,
        })),
      }));
    },
    onSegmentEnd: (_index) => {
      setState((prev) => ({
        ...prev,
        segments: prev.segments.map((s) => ({ ...s, isPlaying: false })),
      }));
    },
    onPlaybackPause: () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        isPaused: true,
      }));
    },
    onPlaybackResume: () => {
      setState((prev) => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
      }));
    },
    onPlaybackStop: () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        isPaused: false,
        isProcessing: false,
        currentSegmentIndex: -1,
        segments: [],
      }));
    },
  });

  // State
  const [state, setState] = React.useState<ProgressiveVoiceState>({
    segments: [],
    currentSegmentIndex: -1,
    isPlaying: false,
    isPaused: false,
    isProcessing: false,
    volume,
    isMuted,
    isVoiceEnabled,
  });

  // Keep state in sync with audio control hook
  React.useEffect(() => {
    setState((prev) => ({ ...prev, volume, isMuted }));
  }, [volume, isMuted]);

  // API key state
  const [apiKey, setApiKey] = React.useState<string | null>(null);
  const apiKeyRef = React.useRef<string | null>(null);

  // Update ref when apiKey changes
  React.useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  // Audio management
  const abortController = React.useRef<AbortController | null>(null);

  // Fetch API key from Supabase secrets or environment
  React.useEffect(() => {
    const fetchApiKey = async () => {
      try {
        logger.info('🔑 Attempting to retrieve ElevenLabs API key...');

        // Try environment variable first (for development)
        const envApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
        if (envApiKey) {
          logger.info('✅ Using ElevenLabs API key from environment variable');
          setApiKey(envApiKey);
          apiKeyRef.current = envApiKey; // Set ref immediately
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
          apiKeyRef.current = data.secret; // Set ref immediately
        } else {
          logger.error('❌ Empty response from get-secret function:', data);
          throw new Error('ElevenLabs API key is empty or not found');
        }
      } catch (error) {
        logger.error('❌ Error fetching API key for progressive voice:', error);

        // Show detailed error message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        toast({
          title: 'API Key Configuration Error',
          description: `Failed to retrieve ElevenLabs API key: ${errorMessage}. Check console for details.`,
          variant: 'destructive',
        });

        // Set error state
        setState((prev) => ({ ...prev, error: `API Key Error: ${errorMessage}` }));
      }
    };

    fetchApiKey();
  }, [toast]);

  /**
   * Progressive generation and playback
   * NOTE: Must be declared before speakAISegments to avoid TDZ errors
   */
  const processSegmentsProgressively = React.useCallback(
    async (segments: VoiceSegment[], startIndex: number = 0): Promise<void> => {
      logger.info(
        '🎪 Starting progressive processing of',
        segments.length,
        'segments',
        startIndex > 0 ? `from index ${startIndex}` : '',
      );

      setState((prev) => ({ ...prev, isPlaying: true }));

      for (let i = 0; i < segments.length; i++) {
        const actualIndex = startIndex + i;
        // Check if we should abort
        if (abortController.current?.signal.aborted) {
          logger.info('🛑 Processing aborted at segment', actualIndex + 1, 'due to abort signal');
          break;
        }

        const segment = segments[i];

        try {
          logger.info(`🎵 Processing segment ${actualIndex + 1}: ${segment.character}`);

          // Update current segment index
          setState((prev) => ({
            ...prev,
            currentSegmentIndex: actualIndex,
            segments: prev.segments.map((s, idx) =>
              idx === actualIndex ? { ...s, isGenerating: true } : s,
            ),
          }));

          // Generate audio for this segment (if not already generated)
          let segmentWithAudio = segment;
          if (!segment.audioUrl) {
            segmentWithAudio = await VoiceDirector.generateAudio(segment, apiKeyRef.current!);

            // Update segment with audio
            setState((prev) => ({
              ...prev,
              segments: prev.segments.map((s, idx) => (idx === actualIndex ? segmentWithAudio : s)),
            }));
          }

          // If generation failed, log and continue
          if (segmentWithAudio.error) {
            logger.warn(
              `⚠️ Audio generation failed for segment ${actualIndex + 1}:`,
              segmentWithAudio.error,
            );
            continue;
          }

          // Play the audio
          if (segmentWithAudio.audioUrl) {
            await playAudioSegment(segmentWithAudio, actualIndex);
          }
        } catch (error) {
          logger.error(`❌ Error processing segment ${actualIndex + 1}:`, error);
          // Continue with next segment
          continue;
        }
      }

      // Playback complete
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        isPaused: false,
        isProcessing: false,
        currentSegmentIndex: -1,
      }));

      logger.info('🏁 Progressive processing complete');
    },
    [playAudioSegment],
  );

  /**
   * Stop current playback completely
   * NOTE: Must be declared before speakAISegments to avoid TDZ errors
   */
  const stopPlayback = React.useCallback(() => {
    baseStopPlayback(state.segments);

    // Abort any ongoing processing
    if (abortController.current) {
      abortController.current.abort();
    }
  }, [state.segments, baseStopPlayback]);

  /**
   * Main function: Process and play AI segments
   */
  const speakAISegments = React.useCallback(
    async (aiSegments: AISegment[]): Promise<void> => {
      logger.info('🎭 Progressive Voice: speakAISegments called with:', {
        segmentCount: aiSegments?.length || 0,
        isVoiceEnabled: state.isVoiceEnabled,
        isProcessing: state.isProcessing,
      });

      if (!state.isVoiceEnabled || !aiSegments?.length || state.isProcessing) {
        logger.info('🚫 Voice not enabled, no segments, or already processing');
        return;
      }

      // Wait for API key if it's not available yet (max 3 seconds)
      const currentApiKey = apiKeyRef.current;
      if (!currentApiKey) {
        logger.info('⏳ API key not ready, waiting...');

        let attempts = 0;
        const maxAttempts = 30; // 3 seconds at 100ms intervals

        while (!apiKeyRef.current && attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          attempts++;
        }

        if (!apiKeyRef.current) {
          logger.error('❌ API key is still missing after waiting');
          setState((prev) => ({
            ...prev,
            error: 'API key timeout - could not retrieve ElevenLabs API key',
          }));
          toast({
            title: 'API Key Timeout',
            description:
              'ElevenLabs API key could not be retrieved. Please check your configuration.',
            variant: 'destructive',
          });
          return;
        }

        logger.info('✅ API key is now available after waiting');
      }

      logger.info('🎭 Progressive Voice: Starting to process', aiSegments.length, 'AI segments');

      // Abort any ongoing processing
      if (abortController.current) {
        logger.info('⚠️ Aborting previous audio processing');
        abortController.current.abort();
      }
      abortController.current = new AbortController();
      logger.info('🆕 Created new abort controller for audio processing');

      // Stop current audio only if actually playing or processing
      if (state.isPlaying || currentAudio.current) {
        logger.info('🛑 Stopping current audio before starting new segments');
        stopPlayback();
      }

      // SIMPLIFIED: Initialize audio context during user interaction to comply with browser autoplay policies
      const initializedAudio = initializeAudioContext();
      if (initializedAudio) {
        logger.info('✅ Audio element ready for playback');
      }

      setState((prev) => ({ ...prev, isProcessing: true, error: undefined }));

      try {
        // Step 1: Convert AI segments to voice segments using VoiceDirector
        const validatedSegments = VoiceDirector.validateAISegments(aiSegments);
        logger.info('📝 Validated segments:', validatedSegments.length);

        const voiceSegments = VoiceDirector.processAISegments(validatedSegments);
        logger.info('🎵 Voice segments created:', voiceSegments.length);

        if (voiceSegments.length === 0) {
          throw new Error('No valid voice segments created');
        }

        // Step 2: Update state with voice segments
        setState((prev) => ({
          ...prev,
          segments: voiceSegments,
          currentSegmentIndex: 0,
        }));

        // Step 3: Start progressive generation and playback
        await processSegmentsProgressively(voiceSegments);
      } catch (error) {
        logger.error('❌ Error in speakAISegments:', error);
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to process voice segments';

        setState((prev) => ({
          ...prev,
          error: errorMessage,
          isProcessing: false,
        }));

        toast({
          title: 'Voice Error',
          description: errorMessage,
          variant: 'destructive',
        });
      }
    },
    [
      state.isVoiceEnabled,
      state.isProcessing,
      toast,
      initializeAudioContext,
      stopPlayback,
      processSegmentsProgressively,
      currentAudio,
    ],
  );

  /**
   * Fallback: Process plain text when AI segments aren't available
   */
  const speakPlainText = React.useCallback(
    async (text: string): Promise<void> => {
      if (!state.isVoiceEnabled || !text?.trim() || state.isProcessing) {
        return;
      }

      logger.info('📝 Progressive Voice: Processing plain text as fallback');

      const voiceSegments = VoiceDirector.processPlainText(text);
      if (voiceSegments.length === 0) {
        return;
      }

      // Use the AI segments path for consistency
      await speakAISegments([
        {
          type: 'dm',
          text: text,
          character: undefined,
          voice_category: undefined,
        },
      ]);
    },
    [state.isVoiceEnabled, state.isProcessing, speakAISegments],
  );

  /**
   * Resume paused playback from current position
   */
  const resumePlayback = React.useCallback(async () => {
    // Attempt to resume the current audio element first
    const resumed = await baseResumePlayback();
    if (resumed) {
      return;
    }

    // If no current audio or not paused, continue with remaining segments
    if (state.segments.length > 0 && state.currentSegmentIndex >= 0) {
      logger.info(`🎪 Continuing from segment ${state.currentSegmentIndex + 1}`);

      setState((prev) => ({
        ...prev,
        isPlaying: true,
        isPaused: false,
        isProcessing: true,
      }));

      // Continue processing from current segment index
      const remainingSegments = state.segments.slice(state.currentSegmentIndex);
      await processSegmentsProgressively(remainingSegments, state.currentSegmentIndex);
    }
  }, [state.segments, state.currentSegmentIndex, baseResumePlayback]);

  /**
   * Pause current playback without losing state
   */
  const pausePlayback = React.useCallback(() => {
    basePausePlayback();
  }, [basePausePlayback]);

  /**
   * Mute toggle
   */
  const toggleMute = React.useCallback(() => {
    baseToggleMute();
  }, [baseToggleMute]);

  /**
   * Voice mode toggle
   */
  const toggleVoiceEnabled = React.useCallback(() => {
    const newVoiceState = !state.isVoiceEnabled;

    setState((prev) => ({ ...prev, isVoiceEnabled: newVoiceState }));
    setIsVoiceEnabled(newVoiceState);

    if (!newVoiceState) {
      stopPlayback();
    }

    toast({
      title: newVoiceState ? 'Progressive Voice Enabled' : 'Progressive Voice Disabled',
      description: newVoiceState
        ? 'Character voices are now active with progressive generation'
        : 'Progressive voice is now disabled',
    });
  }, [state.isVoiceEnabled, stopPlayback, toast, setIsVoiceEnabled]);

  /**
   * Manual API key retry function
   */
  const retryApiKeyFetch = React.useCallback(async () => {
    logger.info('🔄 Manually retrying API key fetch...');
    setApiKey(null);
    setState((prev) => ({ ...prev, error: undefined }));

    try {
      // Try environment variable first (for development)
      const envApiKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
      if (envApiKey) {
        logger.info('✅ Using ElevenLabs API key from environment variable');
        setApiKey(envApiKey);
        apiKeyRef.current = envApiKey; // Set ref immediately
        toast({
          title: 'API Key Retrieved',
          description: 'ElevenLabs API key loaded from environment variable.',
        });
        return;
      }

      // Fallback to Supabase edge function (for production)
      const { data, error } = await supabase.functions.invoke('get-secret', {
        body: { secretName: 'ELEVEN_LABS_API_KEY' },
      });

      if (error) {
        throw new Error(`Failed to call get-secret: ${error.message}`);
      }

      if (data?.secret) {
        logger.info('✅ Retrieved ElevenLabs API key from Supabase secrets');
        setApiKey(data.secret);
        apiKeyRef.current = data.secret; // Set ref immediately
        toast({
          title: 'API Key Retrieved',
          description: 'ElevenLabs API key loaded from Supabase secrets.',
        });
      } else {
        throw new Error('ElevenLabs API key is empty or not found');
      }
    } catch (error) {
      logger.error('❌ Error in manual API key retry:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({ ...prev, error: `API Key Error: ${errorMessage}` }));
      toast({
        title: 'API Key Error',
        description: `Still unable to retrieve API key: ${errorMessage}`,
        variant: 'destructive',
      });
    }
  }, [toast]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (abortController.current) {
        abortController.current.abort();
      }
      stopPlayback();
    };
  }, []); // Empty dependency array - only run on mount/unmount

  return {
    // State
    segments: state.segments,
    currentSegmentIndex: state.currentSegmentIndex,
    isPlaying: state.isPlaying,
    isPaused: state.isPaused,
    isProcessing: state.isProcessing,
    volume: state.volume,
    isMuted: state.isMuted,
    isVoiceEnabled: state.isVoiceEnabled,
    error: state.error,
    apiKey, // Expose API key state for debugging

    // Actions
    speakAISegments, // Main function for AI-generated segments
    speakPlainText, // Fallback for plain text
    pausePlayback, // Pause without losing state
    resumePlayback, // Resume from pause
    stopPlayback, // Stop completely
    setVolume: handleSetVolume,
    toggleMute,
    toggleVoiceEnabled,
    retryApiKeyFetch, // Manual API key retry

    // Voice management utilities
    getCharacterVoiceMappings: VoiceDirector.getCharacterVoiceMappings,
    clearCharacterVoiceMappings: VoiceDirector.clearCharacterVoiceMappings,
    getAvailableVoiceCategories: VoiceDirector.getAvailableVoiceCategories,
    initializeAudioContext, // Initialize audio context during user interaction

    // Audio cache management
    clearAudioCache: VoiceDirector.clearAudioCache,
    getAudioCacheStats: VoiceDirector.getAudioCacheStats,
  };
};
