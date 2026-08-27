import { AlertCircle } from 'lucide-react';
import React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface VoiceStatusAlertsProps {
  error?: string;
  isProcessing: boolean;
  hasUserInteracted: boolean;
  isPlaying: boolean;
  handleRetry: () => void;
}

/**
 * VoiceStatusAlerts Component
 * Extracted from ProgressiveVoicePlayer.tsx
 * Displays status and error alerts for the voice system
 */
export const VoiceStatusAlerts: React.FC<VoiceStatusAlertsProps> = ({
  error,
  isProcessing,
  hasUserInteracted,
  isPlaying,
  handleRetry,
}) => {
  return (
    <div className="space-y-4">
      {/* Error Alert */}
      {error && !isProcessing && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error}{' '}
            <Button
              variant="link"
              size="sm"
              onClick={handleRetry}
              className="h-auto p-0 text-destructive underline"
            >
              Click to retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* First Time User Help */}
      {!hasUserInteracted && !isPlaying && !isProcessing && !error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            🎙️ <strong>Welcome to Voice Narration!</strong>
            <br />
            Click the ▶ Play button or the 🧪 Test button to start audio. Once you interact, future
            AI responses will auto-play (if enabled).
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
