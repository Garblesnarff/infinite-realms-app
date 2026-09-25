import { useSyncExternalStore } from 'react';

import {
  type VoiceModeStatus,
  getVoiceModeStatus,
  subscribeVoiceMode,
} from '@/services/voice/voice-mode-store';

/** Premium / Standard mode, session fallback and Standard download progress. */
export function useVoiceModeStatus(): VoiceModeStatus {
  return useSyncExternalStore(subscribeVoiceMode, getVoiceModeStatus, getVoiceModeStatus);
}
