import { AlertCircle, Download, Info } from 'lucide-react';
import React from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useVoiceModeStatus } from '@/hooks/voice/use-voice-mode';
import {
  PREMIUM_FALLBACK_MESSAGES,
  dismissFallbackNotice,
} from '@/services/voice/voice-mode-store';

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
  const { fallbackReason, fallbackNoticeDismissed, download } = useVoiceModeStatus();
  const downloadPercent =
    download.total > 0 ? Math.min(100, Math.round((download.loaded / download.total) * 100)) : 0;

  return (
    <div className="space-y-4">
      {/* Premium -> Standard fallback: shown once per session until dismissed */}
      {fallbackReason && !fallbackNoticeDismissed && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            {PREMIUM_FALLBACK_MESSAGES[fallbackReason]}{' '}
            <Button
              variant="link"
              size="sm"
              onClick={dismissFallbackNotice}
              className="h-auto p-0 underline"
            >
              OK
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Standard voice model download (first use only; cached by the browser after) */}
      {download.state === 'loading' && (
        <Alert>
          <Download className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <span>
              Downloading Standard voice (about 90 MB, one time)
              {download.total > 0 ? ` — ${downloadPercent}%` : '…'}
            </span>
            <Progress
              value={downloadPercent}
              className="h-2"
              aria-label="Standard voice download progress"
            />
          </AlertDescription>
        </Alert>
      )}
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
