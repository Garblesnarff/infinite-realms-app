import { nearestNarrationSpeed } from './table-settings';

/** Same key `useVoiceAudioControl` already reads for the audio element's volume. */
export const VOICE_VOLUME_KEY = 'progressive-voice-volume';

/** Read at play time and applied as `HTMLAudioElement.playbackRate`. */
export const VOICE_RATE_KEY = 'progressive-voice-rate';

/** Writes a number the voice hook already understands, and tells same-tab listeners. */
export const writeVoiceNumber = (key: string, value: number): void => {
  try {
    const next = JSON.stringify(value);
    window.localStorage.setItem(key, next);
    window.dispatchEvent(
      new StorageEvent('storage', { key, newValue: next, storageArea: window.localStorage }),
    );
  } catch {
    // Storage is blocked: the next play keeps the last rate or volume it read.
  }
};

/**
 * Narration speed. Offers the same three speeds as the Table settings, so a stored value that is
 * not offered (an old 1.5, for example) plays at the nearest one. A missing key plays at 1.
 */
export const readVoiceRate = (): number => {
  try {
    const raw = window.localStorage.getItem(VOICE_RATE_KEY);
    if (!raw) return 1;
    const parsed: unknown = JSON.parse(raw);
    return nearestNarrationSpeed(parsed);
  } catch {
    // Unreadable: play at normal speed.
  }
  return 1;
};
