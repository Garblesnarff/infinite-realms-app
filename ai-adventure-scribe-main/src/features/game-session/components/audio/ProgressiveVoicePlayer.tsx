import {
  Users,
  AlertCircle,
} from 'lucide-react';
import React from 'react';

import { VoicePlaybackStatus } from './VoicePlaybackStatus';
import { VoicePlayerControls } from './VoicePlayerControls';
import { VoiceSegmentsPreview } from './VoiceSegmentsPreview';

import type { NarrationSegment } from '@/hooks/use-ai-response';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useProgressiveVoice } from '@/hooks/use-progressive-voice';
import logger from '@/lib/logger';

interface ProgressiveVoicePlayerProps {
  text: string;
  narrationSegments?: NarrationSegment[]; // Pre-segmented narration from AI
  isEnabled?: boolean;
  className?: string;
}


/**
 * ProgressiveVoicePlayer Component
 *
 * Simplified multi-voice player that uses progressive audio generation.
 * Replaces the complex MultiVoicePlayer with a cleaner, more reliable approach.
 */
export const ProgressiveVoicePlayer: React.FC<ProgressiveVoicePlayerProps> = ({
  text,
  narrationSegments,
  isEnabled = true,
  className = '',
}) => {
  const {
    segments,
    currentSegmentIndex,
    isPlaying,
    isProcessing,
    volume,
    isMuted,
    isVoiceEnabled,
    error,
    apiKey,
    speakAISegments,
    speakPlainText,
    stopPlayback,
    setVolume,
    toggleMute,
    toggleVoiceEnabled,
    retryApiKeyFetch,
    getCharacterVoiceMappings,
    clearCharacterVoiceMappings,
    initializeAudioContext,
  } = useProgressiveVoice();

  const [showSegments, setShowSegments] = React.useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useLocalStorage(
    'progressive-voice-user-interacted',
    false,
  );

  // Simple text change tracking (auto-play disabled)
  const [lastText, setLastText] = React.useState('');

  React.useEffect(() => {
    if (text && text !== lastText && text.trim()) {
      setLastText(text);
      logger.debug('📝 New text received for progressive voice (auto-play disabled):', {
        textLength: text.length,
        hasNarrationSegments: !!(narrationSegments && narrationSegments.length > 0),
        narrationSegmentsLength: narrationSegments?.length || 0,
      });
    }
  }, [text, narrationSegments, lastText]);

  const getSegmentTypeIcon = (type: string): string => {
    return type === 'character' ? '💬' : '📖';
  };

  const calculateProgress = (): number => {
    if (segments.length === 0) return 0;
    if (!isPlaying && !isProcessing) return 0;
    return ((currentSegmentIndex + 1) / segments.length) * 100;
  };


  if (!isEnabled || !text) {
    return null;
  }

  return (
    <TooltipProvider>
      <Card
        className={`bg-white/90 backdrop-blur-sm border-2 border-primary/20 hover:border-primary/40 transition-all duration-200 ${className}`}
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-lg">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <span>Progressive Voice</span>
              {isProcessing && (
                <Badge variant="outline" className="animate-pulse">
                  Processing...
                </Badge>
              )}
              {error && (
                <Badge variant="destructive" className="text-xs">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  <span>Error</span>
                </Badge>
              )}
              {isVoiceEnabled && !isPlaying && !isProcessing && !error && (
                <Badge variant="secondary" className="text-xs">
                  {!hasUserInteracted ? '⚠️ Click ▶ to activate audio' : '📝 Manual playback only'}
                </Badge>
              )}
              {!isVoiceEnabled && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  🔇 Voice disabled
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="progressive-voice-enabled"
                  checked={isVoiceEnabled}
                  onCheckedChange={toggleVoiceEnabled}
                />
                <Label htmlFor="progressive-voice-enabled" className="text-sm">
                  Enable
                </Label>
              </div>
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          <VoicePlayerControls
            text={text}
            narrationSegments={narrationSegments}
            isVoiceEnabled={isVoiceEnabled}
            isProcessing={isProcessing}
            isPlaying={isPlaying}
            stopPlayback={stopPlayback}
            apiKey={apiKey}
            retryApiKeyFetch={retryApiKeyFetch}
            error={error}
            isMuted={isMuted}
            volume={volume}
            toggleMute={toggleMute}
            setVolume={setVolume}
            showSegments={showSegments}
            setShowSegments={setShowSegments}
            segments={segments}
            initializeAudioContext={initializeAudioContext}
            hasUserInteracted={hasUserInteracted}
            setHasUserInteracted={setHasUserInteracted}
            speakAISegments={speakAISegments}
            speakPlainText={speakPlainText}
            clearCharacterVoiceMappings={clearCharacterVoiceMappings}
          />

          <VoicePlaybackStatus
            isPlaying={isPlaying}
            isProcessing={isProcessing}
            segments={segments}
            currentSegmentIndex={currentSegmentIndex}
            calculateProgress={calculateProgress}
            getSegmentTypeIcon={getSegmentTypeIcon}
          />

          <VoiceSegmentsPreview
            showSegments={showSegments}
            segments={segments}
            currentSegmentIndex={currentSegmentIndex}
            getSegmentTypeIcon={getSegmentTypeIcon}
            getCharacterVoiceMappings={getCharacterVoiceMappings}
          />
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
