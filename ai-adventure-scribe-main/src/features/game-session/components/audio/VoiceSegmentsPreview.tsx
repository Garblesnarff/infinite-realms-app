import { Users } from 'lucide-react';
import React from 'react';

import type { VoiceSegment } from '@/services/voice-routing';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';

interface VoiceSegmentsPreviewProps {
  showSegments: boolean;
  segments: VoiceSegment[];
  currentSegmentIndex: number;
  getSegmentTypeIcon: (type: string) => string;
  getCharacterVoiceMappings: () => Record<string, string>;
}

/**
 * VoiceSegmentsPreview Component
 * Extracted from ProgressiveVoicePlayer.tsx
 * Displays a collapsible preview of all voice segments and character mappings
 */
export const VoiceSegmentsPreview: React.FC<VoiceSegmentsPreviewProps> = ({
  showSegments,
  segments,
  currentSegmentIndex,
  getSegmentTypeIcon,
  getCharacterVoiceMappings,
}) => {
  return (
    <Collapsible open={showSegments}>
      <CollapsibleContent className="space-y-2">
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Users className="h-4 w-4" />
            Voice Segments
          </h4>

          {segments.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No segments to display</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {segments.map((segment, index) => (
                <div
                  key={segment.id}
                  className={`p-2 rounded-lg border transition-colors ${
                    index === currentSegmentIndex
                      ? 'bg-primary/10 border-primary/30'
                      : segment.error
                        ? 'bg-destructive/10 border-destructive/30'
                        : 'bg-muted/30 border-muted'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm" role="img" aria-label={segment.type}>
                      {segment.error ? '⚠️' : getSegmentTypeIcon(segment.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 mb-1">
                        <Badge variant="outline" className="text-xs">
                          {segment.character}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {segment.voiceName}
                        </Badge>
                        {segment.error && (
                          <Badge variant="destructive" className="text-xs">
                            Error
                          </Badge>
                        )}
                        {segment.isGenerating && (
                          <Badge variant="outline" className="text-xs animate-pulse">
                            Generating...
                          </Badge>
                        )}
                        {segment.isPlaying && (
                          <Badge variant="default" className="text-xs">
                            Playing
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {segment.error || segment.text}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Voice Mappings Debug Info */}
          <div className="mt-4 p-2 bg-muted/30 rounded text-xs">
            <strong>Character Voice Mappings:</strong>
            <pre className="mt-1 text-xs overflow-auto">
              {JSON.stringify(getCharacterVoiceMappings(), null, 2)}
            </pre>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
