/** Same key `useVoiceAudioControl` already reads for the audio element's volume. */
export const VOICE_VOLUME_KEY = 'progressive-voice-volume';

/** Read at play time and applied as `HTMLAudioElement.playbackRate`. */
export const VOICE_RATE_KEY = 'progressive-voice-rate';

const SPEEDS = [0.75, 1, 1.25, 1.5] as const;

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

/** Narration speed. Anything else, including a missing key, plays at normal speed. */
export const readVoiceRate = (): number => {
  try {
    const raw = window.localStorage.getItem(VOICE_RATE_KEY);
    if (!raw) return 1;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'number' && (SPEEDS as readonly number[]).includes(parsed)) return parsed;
  } catch {
    // Unreadable: play at normal speed.
  }
  return 1;
};
