import { Loader2, Pause, Play, RotateCw, Volume2, VolumeX } from 'lucide-react';
import React, { useState, useCallback } from 'react';

import type { NarrationSegment } from '@/hooks/use-ai-response';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useVoiceContext } from '@/contexts/VoiceContext';
import { cn } from '@/lib/utils';
import { VOICE_PREPARE_TIMEOUT_MESSAGE } from '@/services/voice/voice-prepare';
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
 * One Listen control that is always visible on a DM message. It shows the five
 * states from the Panels board (#1429): idle Listen, preparing, playing with the
 * equalizer, error Try again, and limit Voice limit reached. Audio is ElevenLabs
 * clips played through an audio element, so the gate is audio support, not
 * speechSynthesis (#1236 C).
 *
 * The limit state shows only when the playback error names a limit or quota:
 * today the voice hook reports every failure as "Voice unavailable", so that
 * string stays the error state until #1348 produces a limit-shaped error.
 * The playing state has no progress bar or time: playback position is not
 * plumbed through VoiceContext, and the engine owns every number.
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
    const isLimit = hasError && /\b(limit|quota)\b/i.test(playbackError ?? '');
    const isTimeout = hasError && playbackError === VOICE_PREPARE_TIMEOUT_MESSAGE;

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

    // Board pill (Panels): 44px, radius 999px, bg #0c1220, 1px border in the state
    // color. The plain look keeps the small ghost button.
    const pillClasses =
      '[body.ir-table-look_&]:!min-h-11 [body.ir-table-look_&]:!rounded-full [body.ir-table-look_&]:!bg-[#0c1220] [body.ir-table-look_&]:!border [body.ir-table-look_&]:!px-[18px] [body.ir-table-look_&]:!pl-[14px] [body.ir-table-look_&]:!text-[15px] [body.ir-table-look_&]:!font-bold [body.ir-table-look_&]:gap-2.5';
    const pillColorClasses = isLimit
      ? '[body.ir-table-look_&]:!border-[#aab3cc] [body.ir-table-look_&]:!text-[#aab3cc]'
      : hasError
        ? '[body.ir-table-look_&]:!border-[#ef8a8a] [body.ir-table-look_&]:!text-[#ef8a8a]'
        : '[body.ir-table-look_&]:!border-[#f3deb0] [body.ir-table-look_&]:!text-[#f3deb0]';

    return (
      <div
        className={cn('flex flex-wrap items-center gap-2', className)}
        onClick={(e) => e.stopPropagation()}
      >
        {isLimit ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-disabled="true"
              className={cn(
                'ir-hit-slop ir-tts gap-1 px-3 text-xs',
                'text-muted-foreground',
                pillClasses,
                pillColorClasses,
              )}
              aria-label="Voice limit reached"
            >
              <VolumeX className="h-4 w-4" aria-hidden="true" />
              Voice limit reached
            </Button>
            <span className="text-sm text-muted-foreground [body.ir-table-look_&]:!text-[#aab3cc]">
              The text still works.
            </span>
            <a
              href="/pricing"
              className="inline-flex min-h-11 items-center text-sm font-bold text-infinite-gold [body.ir-table-look_&]:text-[#d5b070]"
            >
              See plans
            </a>
          </>
        ) : hasError ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'ir-hit-slop ir-tts gap-1 px-3 text-xs',
                'text-muted-foreground hover:text-primary',
                pillClasses,
                pillColorClasses,
              )}
              onClick={handleRetry}
              aria-label="The voice failed. Try again"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <span
              role="alert"
              className="text-sm text-muted-foreground [body.ir-table-look_&]:!text-[#ef8a8a]"
            >
              {isTimeout ? 'The voice took too long to prepare.' : 'The voice could not load.'}
            </span>
          </>
        ) : isPreparing ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled
              className={cn(
                'ir-hit-slop ir-tts gap-1 px-3 text-xs',
                'text-muted-foreground',
                pillClasses,
                pillColorClasses,
              )}
              aria-label="Preparing the voice"
              aria-busy="true"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Preparing voice…
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ir-hit-slop px-3 text-xs text-muted-foreground hover:text-primary"
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
              'ir-hit-slop ir-tts gap-1 px-3 text-xs',
              'hover:bg-accent/50 active:scale-95',
              'text-muted-foreground hover:text-primary',
              isCurrentlyPlaying && 'text-primary bg-accent/30',
              pillClasses,
              pillColorClasses,
            )}
            onClick={handlePlay}
            aria-label={isCurrentlyPlaying ? 'Pause the voice' : 'Listen to this message'}
          >
            {isCurrentlyPlaying ? (
              <Pause className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4" aria-hidden="true" />
            )}
            {isCurrentlyPlaying ? 'Pause' : 'Listen'}
          </Button>
        )}

        {/* Playing Indicator: board equalizer bars + Playing */}
        {isCurrentlyPlaying && (
          <div
            className="flex items-center gap-1.5 animate-in slide-in-from-left-2 duration-200"
            aria-live="polite"
            aria-label="Currently playing message"
          >
            <span aria-hidden="true" className="inline-flex h-[18px] items-end">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="mr-[2px] inline-block h-4 w-[3px] animate-pulse rounded-[2px] bg-[#d5b070]"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </span>
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
              className="ir-hit-slop ir-tts p-0 text-muted-foreground hover:text-primary"
              onClick={handleVolumeToggle}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
              aria-pressed={isMuted}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4" aria-hidden="true" />
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
