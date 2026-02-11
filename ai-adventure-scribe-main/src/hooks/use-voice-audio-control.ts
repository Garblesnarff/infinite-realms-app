/**
 * Voice Audio Control Hook
 *
 * Extracted from useProgressiveVoice to handle low-level audio mechanics.
 * Manages HTMLAudioElement lifecycle, volume, and playback controls.
 */
import React from 'react';

import { useLocalStorage } from './use-local-storage';
import { logger } from '../lib/logger';

import type { VoiceSegment } from '@/services/voice-routing';

export interface AudioControlProps {
  onSegmentStart?: (index: number) => void;
  onSegmentEnd?: (index: number, audioUrl: string) => void;
  onPlaybackPause?: () => void;
  onPlaybackResume?: () => void;
  onPlaybackStop?: () => void;
}

export const useVoiceAudioControl = (props: AudioControlProps = {}) => {
  const { onSegmentStart, onSegmentEnd, onPlaybackPause, onPlaybackResume, onPlaybackStop } = props;

  // Persistent settings
  const [volume, setVolume] = useLocalStorage<number>('progressive-voice-volume', 1);
  const [isMuted, setIsMuted] = useLocalStorage<boolean>('progressive-voice-muted', false);

  // Audio refs
  const currentAudio = React.useRef<HTMLAudioElement | null>(null);
  const preCreatedAudio = React.useRef<HTMLAudioElement | null>(null);

  /**
   * Initialize audio context during user interaction for browser autoplay compliance
   */
  const initializeAudioContext = React.useCallback(() => {
    logger.info('🎵 Initializing audio context during user interaction');

    if (!preCreatedAudio.current) {
      preCreatedAudio.current = new Audio();
      preCreatedAudio.current.volume = isMuted ? 0 : volume;
      logger.info('✅ Pre-created audio element during user interaction');
    }

    return preCreatedAudio.current;
  }, [isMuted, volume]);

  /**
   * Play a single audio segment
   */
  const playAudioSegment = React.useCallback((segment: VoiceSegment, index: number): Promise<void> => {
    return new Promise((resolve) => {
      if (!segment.audioUrl) {
        logger.warn(`⚠️ No audio URL for segment ${index + 1}`);
        resolve();
        return;
      }

      logger.info(
        `▶️ Playing segment ${index + 1}: ${segment.character} - "${segment.text.substring(0, 50)}..."`,
      );

      // Use pre-created audio element if available, otherwise create new one
      const audio = preCreatedAudio.current || new Audio();
      preCreatedAudio.current = null; // Reset for next use

      const onLoadedData = () => {
        logger.info(`📦 Audio loaded for segment ${index + 1}`);
        audio.volume = isMuted ? 0 : volume;
        currentAudio.current = audio;

        audio
          .play()
          .then(() => {
            logger.info(`🎵 Successfully started playing segment ${index + 1}`);
          })
          .catch((playError) => {
            logger.error(`❌ Failed to start playing segment ${index + 1}:`, playError);
            resolve();
          });
      };

      const onEnded = () => {
        logger.info(`✅ Segment ${index + 1} finished playing`);

        // Clean up the URL after playing
        if (segment.audioUrl) {
          URL.revokeObjectURL(segment.audioUrl);
        }

        cleanup();
        if (onSegmentEnd) {
          onSegmentEnd(index, segment.audioUrl!);
        }
        resolve();
      };

      const onError = (error: Event) => {
        logger.error(`❌ Audio error for segment ${index + 1}:`, error);
        cleanup();
        resolve();
      };

      const onAbort = () => {
        logger.info(`🛑 Audio aborted for segment ${index + 1}`);
        cleanup();
        resolve();
      };

      const cleanup = () => {
        audio.removeEventListener('loadeddata', onLoadedData);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('abort', onAbort);
        currentAudio.current = null;
      };

      audio.addEventListener('loadeddata', onLoadedData);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);
      audio.addEventListener('abort', onAbort);

      if (onSegmentStart) {
        onSegmentStart(index);
      }

      audio.src = segment.audioUrl;
      audio.load();
    });
  }, [isMuted, volume, onSegmentStart, onSegmentEnd]);

  /**
   * Pause current playback
   */
  const pausePlayback = React.useCallback(() => {
    logger.info('⏸️ Pausing progressive voice playback');
    if (currentAudio.current) {
      currentAudio.current.pause();
    }
    if (onPlaybackPause) {
      onPlaybackPause();
    }
  }, [onPlaybackPause]);

  /**
   * Resume current playback
   */
  const resumePlayback = React.useCallback(async () => {
    logger.info('▶️ Resuming progressive voice playback');
    if (currentAudio.current) {
      try {
        await currentAudio.current.play();
        if (onPlaybackResume) {
          onPlaybackResume();
        }
        return true;
      } catch (error) {
        logger.error('❌ Failed to resume audio:', error);
        return false;
      }
    }
    return false;
  }, [onPlaybackResume]);

  /**
   * Stop current playback
   */
  const stopPlayback = React.useCallback((segments: VoiceSegment[]) => {
    logger.info('🛑 Stopping progressive voice playback');

    if (currentAudio.current) {
      currentAudio.current.pause();
      currentAudio.current.currentTime = 0;
      currentAudio.current = null;
    }

    segments.forEach((segment) => {
      if (segment.audioUrl) {
        URL.revokeObjectURL(segment.audioUrl);
      }
    });

    if (onPlaybackStop) {
      onPlaybackStop();
    }
  }, [onPlaybackStop]);

  /**
   * Volume control
   */
  const handleSetVolume = React.useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolume(clampedVolume);
    if (currentAudio.current) {
      currentAudio.current.volume = isMuted ? 0 : clampedVolume;
    }
  }, [isMuted, setVolume]);

  /**
   * Mute toggle
   */
  const toggleMute = React.useCallback(() => {
    const newMutedState = !isMuted;
    setIsMuted(newMutedState);
    if (currentAudio.current) {
      currentAudio.current.volume = newMutedState ? 0 : volume;
    }
  }, [isMuted, volume, setIsMuted]);

  return {
    volume,
    isMuted,
    currentAudio,
    initializeAudioContext,
    playAudioSegment,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    handleSetVolume,
    toggleMute
  };
};
