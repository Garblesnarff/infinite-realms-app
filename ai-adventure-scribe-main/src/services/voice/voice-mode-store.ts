/**
 * Voice mode store
 *
 * Which voice the player gets, shared by VoiceAudioService (non-React) and the
 * player UI (via useVoiceModeStatus). Persistence:
 * - mode ("premium" | "standard"): localStorage, JSON-encoded like useLocalStorage.
 *   "Off" is the existing 'progressive-voice-enabled' flag, not a third mode.
 * - premium fallback (429/503 switched this session to Standard): sessionStorage.
 * - standard engine (device check result): localStorage, remembered per device.
 */

import logger from '@/lib/logger';

export type VoiceMode = 'premium' | 'standard';
export type PremiumFallbackReason = 'quota' | 'unavailable';
export type StandardEngine = 'kokoro' | 'speech-synthesis';

export interface StandardVoiceDownload {
  state: 'idle' | 'loading' | 'ready' | 'error';
  loaded: number;
  total: number;
}

export interface VoiceModeStatus {
  mode: VoiceMode;
  fallbackReason: PremiumFallbackReason | null;
  fallbackNoticeDismissed: boolean;
  standardEngine: StandardEngine | null;
  download: StandardVoiceDownload;
}

/** What VoiceStatusAlerts tells the player when premium falls back (quota vs outage). */
export const PREMIUM_FALLBACK_MESSAGES: Record<PremiumFallbackReason, string> = {
  quota: 'Premium voice is used up for now — using Standard voice',
  unavailable: 'Premium voice is unavailable right now — using Standard voice',
};

export const VOICE_MODE_KEY = 'progressive-voice-mode';
export const STANDARD_ENGINE_KEY = 'progressive-voice-standard-engine';
export const PREMIUM_FALLBACK_KEY = 'progressive-voice-premium-fallback';
export const FALLBACK_NOTICE_DISMISSED_KEY = 'progressive-voice-fallback-notice-dismissed';

function read(storage: 'localStorage' | 'sessionStorage', key: string): unknown {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window[storage].getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(storage: 'localStorage' | 'sessionStorage', key: string, value: unknown): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) {
      window[storage].removeItem(key);
    } else {
      window[storage].setItem(key, JSON.stringify(value));
    }
  } catch (error) {
    logger.warn(`Error writing ${storage} key "${key}":`, error);
  }
}

function loadStatus(): VoiceModeStatus {
  const mode = read('localStorage', VOICE_MODE_KEY);
  const fallback = read('sessionStorage', PREMIUM_FALLBACK_KEY);
  const engine = read('localStorage', STANDARD_ENGINE_KEY);
  return {
    mode: mode === 'standard' ? 'standard' : 'premium',
    fallbackReason: fallback === 'quota' || fallback === 'unavailable' ? fallback : null,
    fallbackNoticeDismissed: read('sessionStorage', FALLBACK_NOTICE_DISMISSED_KEY) === true,
    standardEngine: engine === 'kokoro' || engine === 'speech-synthesis' ? engine : null,
    download: { state: 'idle', loaded: 0, total: 0 },
  };
}

let status: VoiceModeStatus = loadStatus();
const listeners = new Set<() => void>();

function update(patch: Partial<VoiceModeStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeVoiceMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVoiceModeStatus(): VoiceModeStatus {
  return status;
}

/** Re-read persisted state. Tests use this after clearing storage. */
export function reloadVoiceModeStatus(): void {
  update(loadStatus());
}

/**
 * Picking a mode explicitly clears any session fallback: choosing Premium again
 * means "try premium", and a later 429/503 will fall back (and notify) again.
 */
export function setVoiceMode(mode: VoiceMode): void {
  write('localStorage', VOICE_MODE_KEY, mode);
  write('sessionStorage', PREMIUM_FALLBACK_KEY, null);
  write('sessionStorage', FALLBACK_NOTICE_DISMISSED_KEY, null);
  update({ mode, fallbackReason: null, fallbackNoticeDismissed: false });
}

/** True when segments should come from the Standard voice right now. */
export function isStandardVoiceActive(): boolean {
  return status.mode === 'standard' || status.fallbackReason !== null;
}

/** Returns true only for the call that switched the session over. */
export function activatePremiumFallback(reason: PremiumFallbackReason): boolean {
  if (status.fallbackReason !== null) return false;
  write('sessionStorage', PREMIUM_FALLBACK_KEY, reason);
  update({ fallbackReason: reason });
  logger.warn(`🔁 Premium voice ${reason}; switching this session to Standard voice`);
  return true;
}

export function dismissFallbackNotice(): void {
  write('sessionStorage', FALLBACK_NOTICE_DISMISSED_KEY, true);
  update({ fallbackNoticeDismissed: true });
}

export function setStandardEngine(engine: StandardEngine): void {
  write('localStorage', STANDARD_ENGINE_KEY, engine);
  update({ standardEngine: engine });
}

export function setStandardVoiceDownload(download: StandardVoiceDownload): void {
  update({ download });
}
