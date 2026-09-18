import React from 'react';

import type { VoiceSegment } from '@/services/voice-routing';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface VoicePlaybackStatusProps {
  isPlaying: boolean;
  isProcessing: boolean;
  isStalled?: boolean;
  segments: VoiceSegment[];
  currentSegmentIndex: number;
  calculateProgress: () => number;
  getSegmentTypeIcon: (type: string) => string;
}

/**
 * VoicePlaybackStatus Component
 * Extracted from ProgressiveVoicePlayer.tsx
 * Displays the progress bar and the current playing segment
 */
export const VoicePlaybackStatus: React.FC<VoicePlaybackStatusProps> = ({
  isPlaying,
  isProcessing,
  isStalled = false,
  segments,
  currentSegmentIndex,
  calculateProgress,
  getSegmentTypeIcon,
}) => {
  if (!isPlaying && !isProcessing) return null;

  return (
    <div className="space-y-4">
      {/* Progress Bar */}
      <div className="space-y-2">
        <Progress value={calculateProgress()} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            {isStalled
              ? '…'
              : currentSegmentIndex >= 0
                ? `Segment ${currentSegmentIndex + 1} of ${segments.length}`
                : 'Starting...'}
          </span>
          <span>{segments[currentSegmentIndex]?.character || 'DM'}</span>
        </div>
      </div>

      {/* Current Playing Segment */}
      {isPlaying && currentSegmentIndex >= 0 && segments[currentSegmentIndex] && (
        <Card className="bg-primary/5 border-primary/30">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <span className="text-lg" role="img" aria-label={segments[currentSegmentIndex].type}>
                {getSegmentTypeIcon(segments[currentSegmentIndex].type)}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">
                    {segments[currentSegmentIndex].character}
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {segments[currentSegmentIndex].voiceName}
                  </Badge>
                </div>
                <p className="text-sm leading-relaxed">{segments[currentSegmentIndex].text}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
