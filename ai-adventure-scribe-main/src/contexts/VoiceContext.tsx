import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';

import type { NarrationSegment } from '@/hooks/use-ai-response';

import { convertNarrationToAISegments } from '@/features/game-session/components/audio/voice-utils';
import { useProgressiveVoice } from '@/hooks/use-progressive-voice';
import { extractNarrativeContent } from '@/utils/parseMessageOptions';

interface VoiceContextType {
  currentPlayingId: string | null;
  isPlaying: boolean;
  isPaused: boolean;
  playMessage: (messageId: string, text: string, narrationSegments?: NarrationSegment[]) => void;
  pauseMessage: () => void;
  stopMessage: () => void;
  volume: number;
  isMuted: boolean;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  /** True while the clip for currentPlayingId is being fetched or generated. */
  isProcessing: boolean;
  /** The failure for currentPlayingId, or null. Cleared when that message plays again. */
  playbackError: string | null;
  /** Plays the last requested message again, for the Retry control after an error. */
  retryMessage: () => void;
}

const VoiceContext = createContext<VoiceContextType | undefined>(undefined);

export function useVoiceContext() {
  const context = useContext(VoiceContext);
  if (context === undefined) {
    throw new Error('useVoiceContext must be used within a VoiceProvider');
  }
  return context;
}

interface VoiceProviderProps {
  children: React.ReactNode;
  sessionId?: string;
}

export function VoiceProvider({ children, sessionId }: VoiceProviderProps) {
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string>('');
  const lastRequestRef = React.useRef<{
    messageId: string;
    text: string;
    narrationSegments?: NarrationSegment[];
  } | null>(null);

  // Use the existing progressive voice hook
  const {
    isPlaying,
    isPaused,
    isProcessing,
    error: playbackError,
    volume,
    isMuted,
    isVoiceEnabled: _isVoiceEnabled,
    speakAISegments,
    speakPlainText,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    setVolume,
    toggleMute,
    initializeAudioContext,
  } = useProgressiveVoice({ sessionId });

  const playMessage = useCallback(
    (messageId: string, text: string, narrationSegments?: NarrationSegment[]) => {
      // Initialize audio context for browser compatibility
      initializeAudioContext();
      lastRequestRef.current = { messageId, text, narrationSegments };

      // If this is the same message and it's paused, resume it
      if (currentPlayingId === messageId && isPaused) {
        resumePlayback();
        setAnnouncement('Resuming message playback');
        return;
      }

      // Stop current message if different message is playing
      if (currentPlayingId && currentPlayingId !== messageId) {
        stopPlayback();
      }

      setCurrentPlayingId(messageId);
      setAnnouncement('Playing message with text-to-speech');

      // Use AI segments if available, otherwise fall back to plain text
      if (narrationSegments && narrationSegments.length > 0) {
        const aiSegments = convertNarrationToAISegments(narrationSegments);
        speakAISegments(aiSegments);
      } else {
        // Extract narrative content as a safeguard (in case full text with options is passed)
        const narrativeText = extractNarrativeContent(text);
        speakPlainText(narrativeText);
      }
    },
    [
      currentPlayingId,
      isPaused,
      resumePlayback,
      stopPlayback,
      initializeAudioContext,
      speakAISegments,
      speakPlainText,
    ],
  );

  const pauseMessage = useCallback(() => {
    pausePlayback();
    setAnnouncement('Message playback paused');
  }, [pausePlayback]);

  const stopMessage = useCallback(() => {
    stopPlayback();
    setCurrentPlayingId(null);
    setAnnouncement('Message playback stopped');
  }, [stopPlayback]);

  const retryMessage = useCallback(() => {
    const last = lastRequestRef.current;
    if (last) playMessage(last.messageId, last.text, last.narrationSegments);
  }, [playMessage]);

  // Handle when playback ends naturally (but not when paused). A failed clip keeps its
  // message id so the failure and Retry stay on that message.
  React.useEffect(() => {
    if (!isPlaying && !isProcessing && !isPaused && currentPlayingId && !playbackError) {
      // Audio finished naturally (not paused)
      setCurrentPlayingId(null);
    }
  }, [isPlaying, isProcessing, isPaused, currentPlayingId, playbackError]);

  /**
   * ⚡ Bolt: Memoize the context value to prevent unnecessary re-renders
   * of all consumers when VoiceProvider's parent re-renders.
   */
  const contextValue: VoiceContextType = useMemo(
    () => ({
      currentPlayingId,
      isPlaying: isPlaying && !!currentPlayingId,
      isPaused: isPaused && !!currentPlayingId,
      playMessage,
      pauseMessage,
      stopMessage,
      volume,
      isMuted,
      setVolume,
      toggleMute,
      isProcessing: isProcessing && !!currentPlayingId,
      playbackError: currentPlayingId ? (playbackError ?? null) : null,
      retryMessage,
    }),
    [
      currentPlayingId,
      isPlaying,
      isPaused,
      playMessage,
      pauseMessage,
      stopMessage,
      volume,
      isMuted,
      setVolume,
      toggleMute,
      isProcessing,
      playbackError,
      retryMessage,
    ],
  );

  return (
    <VoiceContext.Provider value={contextValue}>
      {children}

      {/* Screen reader announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </VoiceContext.Provider>
  );
}
