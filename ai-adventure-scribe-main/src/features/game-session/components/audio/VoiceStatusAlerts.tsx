import { AlertCircle } from 'lucide-react';
import React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface VoiceStatusAlertsProps {
  error?: string;
  isProcessing: boolean;
  apiKey: string | null;
  hasUserInteracted: boolean;
  isPlaying: boolean;
  retryApiKeyFetch: () => void;
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
  apiKey,
  hasUserInteracted,
  isPlaying,
  retryApiKeyFetch,
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
            {error.includes('API Key') && (
              <Button
                variant="link"
                size="sm"
                onClick={retryApiKeyFetch}
                className="h-auto p-0 text-destructive underline"
              >
                Retry API key fetch
              </Button>
            )}
            {!error.includes('API Key') && (
              <Button
                variant="link"
                size="sm"
                onClick={handleRetry}
                className="h-auto p-0 text-destructive underline"
              >
                Click to retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* API Key Status Alert */}
      {!apiKey && !error && (
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            🔑 <strong>Retrieving API key...</strong>
            <br />
            ElevenLabs API key is being loaded. If this persists, click the 🔄 button to retry.
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
            Click the ▶ Play button or the 🧪 Test button to start audio. Once you interact,
            future AI responses will auto-play (if enabled).
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};
