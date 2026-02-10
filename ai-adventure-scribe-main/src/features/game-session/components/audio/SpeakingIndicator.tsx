import React from 'react';

interface SpeakingIndicatorProps {
  isSpeaking: boolean;
}

/**
 * SpeakingIndicator Component
 * Displays the current speaking status
 */
export const SpeakingIndicator: React.FC<SpeakingIndicatorProps> = ({ isSpeaking }) => {
  if (!isSpeaking) return null;

  return (
    <div role="status" aria-live="polite" className="text-xs font-medium text-primary animate-pulse">
      Speaking...
    </div>
  );
};
