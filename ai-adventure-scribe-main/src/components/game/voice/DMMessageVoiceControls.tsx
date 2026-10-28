import { Loader2, Pause, Play, RotateCw, Volume2, VolumeX } from 'lucide-react';
import React, { useState, useCallback } from 'react';

import type { NarrationSegment } from '@/hooks/use-ai-response';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useVoiceContext } from '@/contexts/VoiceContext';
import { cn } from '@/lib/utils';
import { extractNarrativeContent } from '@/utils/parseMessageOptions';

interface DMMessageVoiceControlsProps {
  messageId: string;
  messageText: string;
  narrationSegments?: NarrationSegment[];
  className?: string;
}

/**
 * DMMessageVoiceControls Component
 *
 * One Listen control that is always visible on a DM message. It shows the states of this
 * message's clip: Preparing voice…, Playing, and Voice unavailable with Retry. Audio is
 * ElevenLabs clips played through an audio element, so the gate is audio support, not
 * speechSynthesis (#1236 C).
 */
export const DMMessageVoiceControls: React.FC<DMMessageVoiceControlsProps> = React.memo(
  ({ messageId, messageText, narrationSegments, className }) => {
    const {
      currentPlayingId,
      isPlaying,
      isProcessing,
      playbackError,
      retryMessage,
      stopMessage,
      playMessage,
      pauseMessage,
      volume,
      isMuted,
      setVolume,
      toggleMute,
    } = useVoiceContext();

    const [showVolumeSlider, setShowVolumeSlider] = useState(false);

    // Audio support check, made once per mount.
    const [isAudioAvailable] = useState(() => {
      return typeof window !== 'undefined' && typeof window.Audio === 'function';
    });

    const isThisMessage = currentPlayingId === messageId;
    const isCurrentlyPlaying = isThisMessage && isPlaying;
    const isPreparing = isThisMessage && isProcessing;
    const hasError = isThisMessage && !!playbackError && !isPreparing;

    const handlePlay = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (isCurrentlyPlaying) {
          pauseMessage();
        } else {
          // Extract narrative content to exclude options from TTS
          const narrativeText = extractNarrativeContent(messageText);
          playMessage(messageId, narrativeText, narrationSegments);
        }
      },
      [isCurrentlyPlaying, pauseMessage, playMessage, messageId, messageText, narrationSegments],
    );

    const handleCancel = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        stopMessage();
      },
      [stopMessage],
    );

    const handleRetry = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        retryMessage();
      },
      [retryMessage],
    );

    const handleVolumeChange = useCallback(
      (values: number[]) => {
        setVolume(values[0]);
      },
      [setVolume],
    );

    const handleVolumeToggle = useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMute();
      },
      [toggleMute],
    );

    if (!isAudioAvailable) {
      return null;
    }

    return (
      <div
        className={cn('flex flex-wrap items-center gap-2', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {hasError ? (
          <>
            <span className="text-xs text-muted-foreground" role="alert">
              Voice unavailable
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ir-hit-slop ir-tts h-11 min-w-11 gap-1 px-3 text-xs text-primary"
              onClick={handleRetry}
              aria-label="Retry voice for this message"
            >
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              Retry
            </Button>
          </>
        ) : isPreparing ? (
          <>
            <span
              className="flex h-11 items-center gap-2 text-xs text-muted-foreground"
              aria-live="polite"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Preparing voice…
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ir-hit-slop h-11 min-w-11 px-3 text-xs text-muted-foreground hover:text-primary"
              onClick={handleCancel}
              aria-label="Cancel preparing voice for this message"
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              'ir-hit-slop ir-tts h-11 min-w-11 gap-1 px-3 text-xs',
              'hover:bg-accent/50 active:scale-95',
              'text-muted-foreground hover:text-primary',
              isCurrentlyPlaying && 'text-primary bg-accent/30',
            )}
            onClick={handlePlay}
            aria-label={
              isCurrentlyPlaying
                ? 'Pause reading this message'
                : 'Play this message with text-to-speech'
            }
            aria-pressed={isCurrentlyPlaying}
          >
            {isCurrentlyPlaying ? (
              <Pause className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Play className="h-3 w-3" aria-hidden="true" />
            )}
            {isCurrentlyPlaying ? 'Pause' : 'Listen'}
          </Button>
        )}

        {/* Playing Indicator */}
        {isCurrentlyPlaying && (
          <div
            className="flex items-center gap-1.5 animate-in slide-in-from-left-2 duration-200"
            aria-live="polite"
            aria-label="Currently playing message"
          >
            <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" aria-hidden="true" />
            <span className="text-xs text-primary font-medium">Playing</span>
            <span className="sr-only">Playing message</span>
          </div>
        )}

        {/* Volume Control - shown while this message plays, or while the slider is open */}
        {(showVolumeSlider || isCurrentlyPlaying) && (
          <div
            className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200"
            onMouseEnter={() => setShowVolumeSlider(true)}
            onMouseLeave={() => setShowVolumeSlider(false)}
            onFocus={() => setShowVolumeSlider(true)}
            onBlur={(e) => {
              // Only hide if focus is moving outside the volume control container
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setShowVolumeSlider(false);
              }
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ir-hit-slop ir-tts h-11 min-w-11 p-0 text-muted-foreground hover:text-primary"
              onClick={handleVolumeToggle}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              aria-pressed={isMuted}
            >
              {isMuted ? (
                <VolumeX className="h-3 w-3" aria-hidden="true" />
              ) : (
                <Volume2 className="h-3 w-3" aria-hidden="true" />
              )}
            </Button>

            {showVolumeSlider && (
              <div className="w-16">
                <Slider
                  value={[isMuted ? 0 : volume]}
                  onValueChange={handleVolumeChange}
                  max={1}
                  step={0.05}
                  className="h-4"
                  aria-label="Volume"
                  getAriaValueText={(v) => `${Math.round(v * 100)}%`}
                />
              </div>
            )}
          </div>
        )}

        {/* Debug note: developer text, never shown to players in a production build (#2256). */}
        {import.meta.env.DEV && narrationSegments && narrationSegments.length > 0 && (
          <span className="sr-only">
            This message has {narrationSegments.length} voice segments with multiple characters
          </span>
        )}
      </div>
    );
  },
);
