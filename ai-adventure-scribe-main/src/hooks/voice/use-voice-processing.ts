/**
 * Voice Processing Hook
 *
 * Extracted from useProgressiveVoice to handle the orchestration of
 * voice segment generation and progressive playback.
 */
import React from 'react';

import { logger } from '../../lib/logger';

import type { ProgressiveVoiceState } from '../use-progressive-voice';
import type { VoiceSegment, AISegment } from '@/services/voice-routing';

import { VoiceDirector } from '@/services/voice-director';

interface VoiceProcessingProps {
  state: ProgressiveVoiceState;
  setState: React.Dispatch<React.SetStateAction<ProgressiveVoiceState>>;
  toast: (props: {
    title: string;
    description: string;
    variant?: 'default' | 'destructive';
  }) => void;
  playAudioSegment: (segment: VoiceSegment, index: number) => Promise<void>;
  initializeAudioContext: () => HTMLAudioElement | null;
  stopPlayback: () => void;
  baseResumePlayback: () => Promise<boolean>;
  currentAudio: React.MutableRefObject<HTMLAudioElement | null>;
}

export const useVoiceProcessing = ({
  state,
  setState,
  toast,
  playAudioSegment,
  initializeAudioContext,
  stopPlayback,
  baseResumePlayback,
  currentAudio,
}: VoiceProcessingProps) => {
  // Audio management
  const abortController = React.useRef<AbortController | null>(null);

  /**
   * Progressive generation and playback
   */
  const processSegmentsProgressively = React.useCallback(
    async (segments: VoiceSegment[], startIndex: number = 0): Promise<void> => {
      // ⚡ Capture the current abort signal to avoid race conditions when a new request starts
      const signal = abortController.current?.signal;

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
        if (signal?.aborted) {
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
            segmentWithAudio = await VoiceDirector.generateAudio(segment);

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
    [playAudioSegment, setState],
  );

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
      state.isPlaying,
      toast,
      initializeAudioContext,
      stopPlayback,
      processSegmentsProgressively,
      currentAudio,
      setState,
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

      // Structured segments already went through speakAISegments. This path
      // must not invent speakers via the dialogue parser.
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
  }, [
    state.segments,
    state.currentSegmentIndex,
    baseResumePlayback,
    processSegmentsProgressively,
    setState,
  ]);

  return React.useMemo(
    () => ({
      speakAISegments,
      speakPlainText,
      resumePlayback,
      abortController,
    }),
    [speakAISegments, speakPlainText, resumePlayback],
  );
};
