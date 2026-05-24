import {
  Play,
  Pause,
  Square,
  Volume2,
  VolumeX,
  Settings,
  RefreshCw,
  Trash2,
  TestTube,
} from 'lucide-react';
import React from 'react';

import { convertNarrationToAISegments } from './voice-utils';
import { VoiceStatusAlerts } from './VoiceStatusAlerts';

import type { NarrationSegment } from '@/hooks/use-ai-response';
import type { AISegment, VoiceSegment } from '@/services/voice-routing';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import logger from '@/lib/logger';


interface VoicePlayerControlsProps {
  text: string;
  narrationSegments?: NarrationSegment[];
  isVoiceEnabled: boolean;
  isProcessing: boolean;
  isPlaying: boolean;
  stopPlayback: () => void;
  apiKey?: string;
  retryApiKeyFetch: () => void;
  error?: string;
  isMuted: boolean;
  volume: number;
  toggleMute: () => void;
  setVolume: (volume: number) => void;
  showSegments: boolean;
  setShowSegments: (show: boolean) => void;
  segments: VoiceSegment[];
  initializeAudioContext: () => void;
  hasUserInteracted: boolean;
  setHasUserInteracted: (interacted: boolean) => void;
  speakAISegments: (segments: AISegment[]) => Promise<void>;
  speakPlainText: (text: string) => Promise<void>;
  clearCharacterVoiceMappings: () => void;
}


/**
 * VoicePlayerControls Component
 * Extracted controls for the ProgressiveVoicePlayer
 */
export const VoicePlayerControls: React.FC<VoicePlayerControlsProps> = ({
  text,
  narrationSegments,
  isVoiceEnabled,
  isProcessing,
  isPlaying,
  stopPlayback,
  apiKey,
  retryApiKeyFetch,
  error,
  isMuted,
  volume,
  toggleMute,
  setVolume,
  showSegments,
  setShowSegments,
  segments,
  initializeAudioContext,
  hasUserInteracted,
  setHasUserInteracted,
  speakAISegments,
  speakPlainText,
  clearCharacterVoiceMappings,
}) => {
  const handlePlayPause = React.useCallback(() => {
    // Initialize audio context during user interaction for browser autoplay compliance
    initializeAudioContext();

    // Mark that user has interacted
    if (!hasUserInteracted) {
      setHasUserInteracted(true);
    }

    if (isPlaying) {
      stopPlayback();
    } else if (!isProcessing) {
      logger.info('🎵 Manual play initiated');
      if (narrationSegments && narrationSegments.length > 0) {
        const aiSegments = convertNarrationToAISegments(narrationSegments);
        speakAISegments(aiSegments);
      } else {
        speakPlainText(text);
      }
    }
  }, [
    isPlaying,
    isProcessing,
    stopPlayback,
    speakAISegments,
    speakPlainText,
    text,
    narrationSegments,
    hasUserInteracted,
    initializeAudioContext,
    setHasUserInteracted,
  ]);

  const handleRetry = React.useCallback(() => {
    if (text && isVoiceEnabled && !isProcessing) {
      if (narrationSegments && narrationSegments.length > 0) {
        const aiSegments = convertNarrationToAISegments(narrationSegments);
        speakAISegments(aiSegments);
      } else {
        speakPlainText(text);
      }
    }
  }, [text, narrationSegments, isVoiceEnabled, isProcessing, speakAISegments, speakPlainText]);

  const handleTestAudio = React.useCallback(async () => {
    logger.info('🧪 Testing audio with simple text...');

    // Mark user interaction
    if (!hasUserInteracted) {
      setHasUserInteracted(true);
    }

    // Test with simple DM narration
    const testSegments: AISegment[] = [
      {
        type: 'dm' as const,
        text: 'This is a test of the audio system.',
        character: undefined,
        voice_category: undefined,
      },
    ];

    await speakAISegments(testSegments);
  }, [speakAISegments, hasUserInteracted, setHasUserInteracted]);

  const handleClearVoiceMappings = React.useCallback(() => {
    logger.info('🔧 Clearing voice mappings...');
    clearCharacterVoiceMappings();
  }, [clearCharacterVoiceMappings]);

  const handleVolumeChange = React.useCallback(
    (values: number[]) => {
      setVolume(values[0]);
    },
    [setVolume],
  );


  return (
    <div className="flex items-center gap-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePlayPause}
            disabled={!isVoiceEnabled || isProcessing || !text}
            className="h-10 w-10 p-0"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            aria-pressed={isPlaying}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isPlaying ? 'Pause' : 'Play'}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={stopPlayback}
            disabled={!isPlaying && !isProcessing}
            className="h-10 w-10 p-0"
            aria-label="Stop"
          >
            <Square className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop</TooltipContent>
      </Tooltip>

      {/* Retry API Key Button */}
      {!apiKey && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryApiKeyFetch}
              className="h-10 w-10 p-0 border-orange-300 text-orange-600 hover:bg-orange-50"
              aria-label="Retry API key fetch"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry API key fetch</TooltipContent>
        </Tooltip>
      )}

      {/* Test Audio Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTestAudio}
            disabled={!isVoiceEnabled || isProcessing}
            className="h-10 w-10 p-0"
            aria-label="Test audio"
          >
            <TestTube className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Test audio</TooltipContent>
      </Tooltip>

      {/* Clear Voice Mappings Button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClearVoiceMappings}
            className="h-10 w-10 p-0"
            aria-label="Clear voice mappings"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Clear voice mappings</TooltipContent>
      </Tooltip>

      {/* Retry Button */}
      {error && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRetry}
              disabled={!isVoiceEnabled || isProcessing}
              className="h-10 w-10 p-0"
              aria-label="Retry"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Retry</TooltipContent>
        </Tooltip>
      )}

      {/* Volume Controls */}
      <div className="flex items-center gap-2 flex-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={toggleMute}
          className="h-8 w-8 p-0"
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
        >
          {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </Button>

        <Slider
          value={[isMuted ? 0 : volume]}
          onValueChange={handleVolumeChange}
          max={1}
          step={0.05}
          className="flex-1"
          aria-label="Adjust playback volume"
        />

        <span className="text-xs text-muted-foreground w-10 text-right">
          {Math.round((isMuted ? 0 : volume) * 100)}%
        </span>
      </div>

      <Collapsible open={showSegments} onOpenChange={setShowSegments}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="h-10">
            <Settings className="h-4 w-4 mr-2" />
            Segments ({segments.length})
          </Button>
        </CollapsibleTrigger>
      </Collapsible>

      <VoiceStatusAlerts
        error={error}
        isProcessing={isProcessing}
        apiKey={apiKey ?? null}
        hasUserInteracted={hasUserInteracted}
        isPlaying={isPlaying}
        retryApiKeyFetch={retryApiKeyFetch}
        handleRetry={handleRetry}
      />
    </div>
  );
};
