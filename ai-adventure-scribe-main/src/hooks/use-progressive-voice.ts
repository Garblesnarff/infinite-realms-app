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
import { useVoiceApiKey } from './voice/use-voice-api-key';
import { useVoiceProcessing } from './voice/use-voice-processing';

import type { VoiceSegment } from '@/services/voice-routing';

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

  const onSegmentStart = React.useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      currentSegmentIndex: index,
      segments: prev.segments.map((s, idx) => ({
        ...s,
        isPlaying: idx === index,
      })),
    }));
  }, []);

  const onSegmentEnd = React.useCallback((_index: number) => {
    setState((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => ({ ...s, isPlaying: false })),
    }));
  }, []);

  const onPlaybackPause = React.useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      isPaused: true,
    }));
  }, []);

  const onPlaybackResume = React.useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPlaying: true,
      isPaused: false,
    }));
  }, []);

  const onPlaybackStop = React.useCallback(() => {
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      isPaused: false,
      isProcessing: false,
      currentSegmentIndex: -1,
      segments: [],
    }));
  }, []);

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
    onSegmentStart,
    onSegmentEnd,
    onPlaybackPause,
    onPlaybackResume,
    onPlaybackStop,
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

  // ElevenLabs API key management
  const {
    apiKey,
    apiKeyRef,
    error: apiKeyError,
    retryApiKeyFetch,
    waitForApiKey,
  } = useVoiceApiKey();

  // Voice processing orchestration
  const {
    speakAISegments,
    speakPlainText,
    resumePlayback,
    abortController
  } = useVoiceProcessing({
    state,
    setState,
    toast,
    apiKeyRef,
    waitForApiKey,
    playAudioSegment,
    initializeAudioContext,
    stopPlayback: React.useCallback(() => {
      baseStopPlayback(state.segments);
      // We'll handle abort inside useVoiceProcessing or by exposing it
    }, [state.segments, baseStopPlayback]),
    baseResumePlayback,
    currentAudio
  });

  /**
   * Stop current playback completely
   */
  const stopPlayback = React.useCallback(() => {
    baseStopPlayback(state.segments);

    // Abort any ongoing processing
    if (abortController.current) {
      abortController.current.abort();
    }
  }, [state.segments, baseStopPlayback, abortController]);

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
  const handleRetryApiKeyFetch = React.useCallback(async () => {
    setState((prev) => ({ ...prev, error: undefined }));
    await retryApiKeyFetch();
  }, [retryApiKeyFetch]);

  // Cleanup on unmount
  React.useEffect(() => {
    const currentAbortController = abortController.current;
    return () => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
      stopPlayback();
    };
  }, [stopPlayback, abortController]);

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
    error: state.error || apiKeyError,
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
    retryApiKeyFetch: handleRetryApiKeyFetch, // Manual API key retry

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
