/**
 * Voice Processing Hook
 *
 * Extracted from useProgressiveVoice to handle the orchestration of
 * voice segment generation and progressive playback.
 */
import React from 'react';

import { logger } from '../../lib/logger';

import type { ProgressiveVoiceState } from '../use-progressive-voice';
import type { VoiceProviderId } from '@/services/voice/voice-provider';
import type { VoiceSegment, AISegment } from '@/services/voice-routing';

import { speakSegment } from '@/services/voice/speech-synthesis-voice';
import { isStandardVoiceActive } from '@/services/voice/voice-mode-store';
import { VoiceDirector } from '@/services/voice-director';

const PREFETCH_CONCURRENCY = 3;
export const SEGMENT_AUDIO_CACHE_MAX = 32;

type CachedSegmentAudio = {
  text: string;
  segment: VoiceSegment;
};

const segmentAudioCache = new Map<string, CachedSegmentAudio>();

export function clearVoiceSegmentAudioCache(): void {
  segmentAudioCache.clear();
}

export function getVoiceSegmentAudioCacheSize(): number {
  return segmentAudioCache.size;
}

function rememberSegment(key: string, segment: VoiceSegment): void {
  if (segmentAudioCache.has(key)) {
    segmentAudioCache.delete(key);
  }
  segmentAudioCache.set(key, { text: segment.text, segment });
  while (segmentAudioCache.size > SEGMENT_AUDIO_CACHE_MAX) {
    const oldest = segmentAudioCache.keys().next().value;
    if (oldest === undefined) break;
    segmentAudioCache.delete(oldest);
  }
}

export function hashSegmentText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash));
}

function segmentCacheKey(segment: VoiceSegment, provider: VoiceProviderId): string {
  return `${provider}:${segment.voiceId ?? ''}:${hashSegmentText(segment.text)}`;
}

async function generateWithCache(
  segment: VoiceSegment,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<VoiceSegment> {
  if (segment.audioUrl) return segment;
  // Look up under the provider that would serve this segment now; store under
  // the one that actually did (a premium 429 mid-turn yields kokoro audio).
  const expectedProvider: VoiceProviderId = isStandardVoiceActive() ? 'kokoro' : 'elevenlabs';
  const key = segmentCacheKey(segment, expectedProvider);
  const cached = segmentAudioCache.get(key);
  if (cached?.segment.audioUrl && cached.text === segment.text) {
    rememberSegment(key, cached.segment);
    return {
      ...segment,
      audioUrl: cached.segment.audioUrl,
      audioBlob: cached.segment.audioBlob,
      provider: cached.segment.provider,
    };
  }
  const generated = await VoiceDirector.generateAudio(segment, signal, sessionId);
  if (generated.audioUrl) {
    rememberSegment(segmentCacheKey(segment, generated.provider ?? expectedProvider), generated);
  }
  return generated;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  /** Game session the voice is played in; absent outside a session. */
  sessionId?: string;
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
  sessionId,
}: VoiceProcessingProps) => {
  // Audio management
  const abortController = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      abortController.current?.abort();
    };
  }, []);

  /**
   * Progressive generation and playback
   */
  const processSegmentsProgressively = React.useCallback(
    async (segments: VoiceSegment[], startIndex: number = 0): Promise<void> => {
      // ⚡ Capture the current abort signal to avoid race conditions when a new request starts
      const signal = abortController.current?.signal;
      // Writes from a run that a newer request replaced are dropped: the newer run owns the state.
      const setStateForRun: typeof setState = (update) => {
        if (abortController.current?.signal === signal) setState(update);
      };
      const prefetchStartedAt = performance.now();

      logger.info(
        '🎪 Starting progressive processing of',
        segments.length,
        'segments',
        startIndex > 0 ? `from index ${startIndex}` : '',
      );

      setStateForRun((prev) => ({ ...prev, isPlaying: true, isStalled: false }));

      const readyFlags = segments.map(() => false);
      let failedGenerations = 0;
      const timings = segments.map(() => ({ requestMs: 0, readyMs: 0 }));
      const slots = segments.map(() => createDeferred<VoiceSegment>());

      const workerCount = Math.min(PREFETCH_CONCURRENCY, segments.length);
      let nextIndex = 0;
      const runWorker = async () => {
        while (true) {
          const i = nextIndex++;
          if (i >= segments.length) return;
          if (signal?.aborted) {
            readyFlags[i] = true;
            slots[i].resolve({ ...segments[i], error: 'aborted' });
            continue;
          }
          const requestStartedAt = performance.now();
          try {
            const generated = await generateWithCache(segments[i], signal, sessionId);
            timings[i] = {
              requestMs: performance.now() - requestStartedAt,
              readyMs: performance.now() - prefetchStartedAt,
            };
            readyFlags[i] = true;
            slots[i].resolve(generated);
          } catch (error) {
            timings[i] = {
              requestMs: performance.now() - requestStartedAt,
              readyMs: performance.now() - prefetchStartedAt,
            };
            readyFlags[i] = true;
            slots[i].resolve({
              ...segments[i],
              error: error instanceof Error ? error.message : 'Audio generation failed',
            });
          }
        }
      };
      void Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      let previousEndedAt = prefetchStartedAt;
      for (let i = 0; i < segments.length; i++) {
        const actualIndex = startIndex + i;
        if (signal?.aborted) {
          logger.info('🛑 Processing aborted at segment', actualIndex + 1, 'due to abort signal');
          break;
        }

        try {
          logger.info(`🎵 Processing segment ${actualIndex + 1}: ${segments[i].character}`);

          setStateForRun((prev) => ({
            ...prev,
            currentSegmentIndex: actualIndex,
            segments: prev.segments.map((s, idx) =>
              idx === actualIndex ? { ...s, isGenerating: true } : s,
            ),
          }));

          const stalled = i > 0 && !readyFlags[i];
          const waitStartedAt = performance.now();
          if (stalled) {
            setStateForRun((prev) => ({ ...prev, isStalled: true }));
          }

          const segmentWithAudio = await slots[i].promise;
          const waitMs = performance.now() - waitStartedAt;
          if (stalled) {
            logger.info('VOICE_SEGMENT_STALL', { index: actualIndex, waitMs });
            setStateForRun((prev) => ({ ...prev, isStalled: false }));
          }

          setStateForRun((prev) => ({
            ...prev,
            segments: prev.segments.map((s, idx) => (idx === actualIndex ? segmentWithAudio : s)),
          }));

          if (segmentWithAudio.error) {
            logger.warn(
              `⚠️ Audio generation failed for segment ${actualIndex + 1}:`,
              segmentWithAudio.error,
            );
            failedGenerations += 1;
            continue;
          }

          const gapMs = performance.now() - previousEndedAt;
          logger.info('VOICE_SEGMENT_TIMING', {
            index: actualIndex,
            voice: segmentWithAudio.voiceId || segmentWithAudio.character,
            requestMs: timings[i].requestMs,
            readyMs: timings[i].readyMs,
            gapMs,
          });

          if (segmentWithAudio.audioUrl) {
            await playAudioSegment(segmentWithAudio, actualIndex);
          } else if (segmentWithAudio.provider === 'speech-synthesis') {
            // Standard voice on a slow device: no blob, the browser speaks it.
            await speakSegment(segmentWithAudio, signal);
          }
          previousEndedAt = performance.now();
        } catch (error) {
          logger.error(`❌ Error processing segment ${actualIndex + 1}:`, error);
          continue;
        }
      }

      // Every segment failed to generate: say so, so the message shows Retry instead of Listen.
      // A run that a newer request replaced writes nothing: that run owns the state now.
      // A run that was stopped still resets the flags below.
      if (abortController.current?.signal !== signal) {
        logger.info('🛑 Superseded run finished; not touching the current state');
        return;
      }

      if (!signal?.aborted && segments.length > 0 && failedGenerations === segments.length) {
        setStateForRun((prev) => ({ ...prev, error: 'Voice unavailable for this message' }));
      }

      setStateForRun((prev) => ({
        ...prev,
        isPlaying: false,
        isPaused: false,
        isProcessing: false,
        isStalled: false,
        currentSegmentIndex: -1,
      }));

      logger.info('🏁 Progressive processing complete');
    },
    [playAudioSegment, setState, sessionId, abortController],
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

      // A run already in progress is aborted below, so a stale isProcessing value here must not
      // swallow a new request (the Listen click on another message while one is preparing).
      if (!state.isVoiceEnabled || !aiSegments?.length) {
        logger.info('🚫 Voice not enabled or no segments');
        return;
      }

      logger.info('🎭 Progressive Voice: Starting to process', aiSegments.length, 'AI segments');

      // Abort any ongoing processing
      if (abortController.current) {
        logger.info('⚠️ Aborting previous audio processing');
        abortController.current.abort();
      }
      const controller = new AbortController();
      abortController.current = controller;
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

        const castSegments = sessionId
          ? await VoiceDirector.castAISegments(validatedSegments, sessionId)
          : validatedSegments;
        if (controller.signal.aborted || abortController.current !== controller) return;
        const voiceSegments = VoiceDirector.processAISegments(castSegments);
        logger.info('🎵 Voice segments created:', voiceSegments.length);

        if (voiceSegments.length === 0) {
          if (validatedSegments.length > 0 && castSegments.length === 0) {
            setState((prev) => ({ ...prev, isProcessing: false }));
            return;
          }
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
        if (controller.signal.aborted || abortController.current !== controller) return;
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
      sessionId,
      setState,
    ],
  );

  /**
   * Fallback: Process plain text when AI segments aren't available
   */
  const speakPlainText = React.useCallback(
    async (text: string): Promise<void> => {
      // A run already in progress is aborted by speakAISegments, so a stale isProcessing value
      // must not drop a click on another message.
      if (!state.isVoiceEnabled || !text?.trim()) {
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
    [state.isVoiceEnabled, speakAISegments],
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
