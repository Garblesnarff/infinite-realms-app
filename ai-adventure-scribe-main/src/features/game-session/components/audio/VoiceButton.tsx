import { Volume2, VolumeX } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface VoiceButtonProps {
  isMuted: boolean;
  isSpeaking: boolean;
  onToggleMute: () => void;
}

/**
 * VoiceButton Component
 * Provides a button to toggle audio mute state with visual feedback
 */
export const VoiceButton: React.FC<VoiceButtonProps> = ({
  isMuted,
  isSpeaking,
  onToggleMute,
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`transition-colors ${isSpeaking ? 'text-primary' : ''}`}
          onClick={onToggleMute}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          aria-pressed={isMuted}
        >
          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{isMuted ? 'Unmute' : 'Mute'}</p>
      </TooltipContent>
    </Tooltip>
  );
};
