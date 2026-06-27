import { Play, Pause, Volume2, VolumeX, AlertCircle, RefreshCw } from 'lucide-react';
import React from 'react';

import type { VoiceSegment } from '@/services/voice-routing';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DMBubbleVoiceSectionProps {
  isVoiceEnabled: boolean;
  isProcessing: boolean;
  isThisMessagePlaying: boolean;
  isMuted: boolean;
  error?: string;
  hasUserInteracted: boolean;
  segments: VoiceSegment[];
  currentSegmentIndex: number;
  handlePlayPause: () => void;
  toggleMute: () => void;
}

export const DMBubbleVoiceSection: React.FC<DMBubbleVoiceSectionProps> = ({
  isVoiceEnabled,
  isProcessing,
  isThisMessagePlaying,
  isMuted,
  error,
  hasUserInteracted,
  segments,
  currentSegmentIndex,
  handlePlayPause,
  toggleMute,
}) => {
  const calculateProgress = (): number => {
    if (!isThisMessagePlaying || segments.length === 0) {
      return 0;
    }
    return ((currentSegmentIndex + 1) / segments.length) * 100;
  };

  const formatTime = (segmentIndex: number, totalSegments: number): string => {
    // Simple time calculation - could be enhanced with actual audio durations
    const estimatedDuration = totalSegments * 3; // 3 seconds per segment estimate
    const currentTime = segmentIndex * 3;

    const formatSeconds = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return `${formatSeconds(currentTime)} / ${formatSeconds(estimatedDuration)}`;
  };

  if (!isVoiceEnabled) {
    return null;
  }

  return (
    <>
      {/* Enhanced Voice Controls */}
      <div className="flex items-center gap-3 pt-3 border-t border-white/10">
        {/* Enhanced Play/Pause Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handlePlayPause}
              disabled={isProcessing}
              className="h-9 w-9 p-0 rounded-full hover:bg-infinite-purple/20 focus-glow transition-all duration-200 hover:scale-105"
              aria-label={isThisMessagePlaying ? 'Pause narration' : 'Play narration'}
              aria-pressed={isThisMessagePlaying}
            >
              {isThisMessagePlaying ? (
                <Pause className="h-4 w-4 text-infinite-teal" aria-hidden="true" />
              ) : (
                <Play className="h-4 w-4 text-infinite-gold" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isThisMessagePlaying ? 'Pause' : 'Play'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Enhanced Progress Bar */}
        {isThisMessagePlaying && (
          <div className="flex-1 flex items-center gap-3">
            <div
              className="flex-1 bg-white/10 rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-label="Narration progress"
              aria-valuenow={Math.round(calculateProgress())}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-gradient-to-r from-infinite-teal to-infinite-purple transition-all duration-300 ease-out rounded-full"
                style={{ width: `${calculateProgress()}%` }}
              ></div>
            </div>
            <span className="text-xs text-muted-foreground/80 font-mono min-w-[4rem] bg-card/50 px-2 py-1 rounded">
              {formatTime(currentSegmentIndex, segments.length)}
            </span>
          </div>
        )}

        {/* Enhanced Volume Control */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleMute}
              className="h-9 w-9 p-0 rounded-full hover:bg-infinite-teal/20 focus-glow transition-all duration-200 hover:scale-105"
              aria-label={isMuted ? 'Unmute narration' : 'Mute narration'}
              aria-pressed={isMuted}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4 text-red-400" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4 text-infinite-teal" aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{isMuted ? 'Unmute' : 'Mute'}</p>
          </TooltipContent>
        </Tooltip>

        {/* Enhanced Error State */}
        {error && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePlayPause}
                className="h-9 w-9 p-0 rounded-full hover:bg-destructive/20 text-destructive focus-glow transition-all duration-200 hover:scale-105"
                aria-label="Retry narration"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Retry</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Enhanced Processing Indicator */}
      {isProcessing &&
        isThisMessagePlaying &&
        !(currentSegmentIndex >= 0 && segments[currentSegmentIndex]) && (
          <div
            className="flex items-center gap-3 pt-3 border-t border-white/10"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-infinite-purple/10 px-3 py-1 rounded-full">
              <div className="flex gap-1" aria-hidden="true">
                <div className="w-1.5 h-1.5 bg-infinite-purple rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-infinite-teal rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-infinite-gold rounded-full animate-bounce"></div>
              </div>
              <span className="font-medium">Weaving mystical audio...</span>
            </div>
          </div>
        )}

      {/* Enhanced Current Segment Info */}
      {isThisMessagePlaying &&
        currentSegmentIndex >= 0 &&
        segments[currentSegmentIndex] && (
          <div className="flex items-center gap-3 pt-3 border-t border-white/10">
            <div className="flex items-center gap-2 text-xs bg-gradient-to-r from-infinite-purple/10 to-infinite-teal/10 px-3 py-1 rounded-full">
              <span className="text-infinite-gold font-bold">
                🎭 {segments[currentSegmentIndex].character || 'Dungeon Master'}
              </span>
              <span className="text-muted-foreground/80 font-mono">
                {currentSegmentIndex + 1}/{segments.length}
              </span>
            </div>
          </div>
        )}

      {/* Enhanced Error Message */}
      {error && !isProcessing && (
        <div
          className="flex items-center gap-3 pt-3 border-t border-destructive/20"
          role="status"
        >
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 px-3 py-1 rounded-full">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <span className="font-medium">
              Mystical interference detected - click retry
            </span>
          </div>
        </div>
      )}

      {/* Enhanced First Time User Help */}
      {!hasUserInteracted && !isThisMessagePlaying && !isProcessing && !error && (
        <div className="pt-3 border-t border-white/10">
          <div className="flex items-center gap-2 text-xs text-muted-foreground/80 bg-infinite-gold/10 px-3 py-1 rounded-full animate-pulse">
            <span className="text-infinite-gold">✨</span>
            <span className="font-medium">
              Click play to hear the Dungeon Master's voice
            </span>
          </div>
        </div>
      )}
    </>
  );
};
