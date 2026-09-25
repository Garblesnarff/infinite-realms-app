/**
 * Standard voice on devices too slow for Kokoro: window.speechSynthesis.
 *
 * speechSynthesis speaks directly and cannot hand back a blob, so these
 * segments carry no audioUrl. use-voice-processing speaks them in order in
 * place of playAudioSegment; the HTMLAudioElement path is untouched.
 */

import { type VoiceSegment, hashCharacterName } from '../voice-routing';

export function hasSpeechSynthesis(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/** Same category -> same browser voice, from whatever English voices exist. */
function pickVoice(category: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  if (voices.length === 0) return undefined;
  return voices[hashCharacterName(category) % voices.length];
}

export function speakSegment(segment: VoiceSegment, signal?: AbortSignal): Promise<void> {
  if (!hasSpeechSynthesis() || signal?.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(segment.text);
    const voice = pickVoice(segment.voiceCategory ?? 'narrator');
    if (voice) utterance.voice = voice;

    const finish = (): void => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = (): void => {
      window.speechSynthesis.cancel();
      finish();
    };

    utterance.onend = finish;
    utterance.onerror = finish;
    signal?.addEventListener('abort', onAbort, { once: true });
    window.speechSynthesis.speak(utterance);
  });
}
