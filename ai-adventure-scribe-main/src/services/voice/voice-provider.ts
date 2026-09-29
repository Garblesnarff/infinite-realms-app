/**
 * Voice provider contract.
 *
 * VoiceAudioService is the single funnel for segment audio; it asks a provider
 * for the audio of one segment and never cares how the provider made it.
 * Playback (use-voice-audio-control.ts) only ever sees `audioUrl`.
 */

import type { VoiceSegment } from '../voice-routing';

/**
 * `elevenlabs` = premium (server proxy), `kokoro` = standard (in-browser model),
 * `speech-synthesis` = standard on devices too slow for Kokoro. The last one
 * cannot produce a blob, so it is not a VoiceProvider; see speech-synthesis-voice.ts.
 */
export type VoiceProviderId = 'elevenlabs' | 'kokoro' | 'speech-synthesis';

/**
 * The voice a segment asked for. `category` is a VOICE_CONFIGS key (narrator,
 * goblin, ...). `voiceId` is the ElevenLabs id assignVoice picked; it is not
 * derivable from the category (pool voices, and hero_male/guard share an id),
 * so both travel together and each provider uses the one it understands.
 */
export interface VoiceRef {
  category: string;
  voiceId: string;
}

export interface GeneratedAudio {
  audioBlob: Blob;
  audioUrl: string;
}

export interface VoiceProvider {
  readonly id: Exclude<VoiceProviderId, 'speech-synthesis'>;
  /** The provider's own voice id for this request; used in cache keys. */
  resolveVoiceId(voice: VoiceRef): string;
  generateAudio(
    text: string,
    voice: VoiceRef,
    settings: VoiceSegment['voiceSettings'],
    signal?: AbortSignal,
    /** Game session the voice is for, so the server can price it to the session (#2269). */
    sessionId?: string,
  ): Promise<GeneratedAudio>;
}

/**
 * Status-aware provider errors. 429 means the premium allowance is used up;
 * 503 means the premium service is down. Both switch the session to Standard.
 */
export class VoiceProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'VoiceProviderError';
    this.status = status;
  }
}

export class VoiceQuotaError extends VoiceProviderError {
  constructor(message: string) {
    super(message, 429);
    this.name = 'VoiceQuotaError';
  }
}

export class VoiceUnavailableError extends VoiceProviderError {
  constructor(message: string) {
    super(message, 503);
    this.name = 'VoiceUnavailableError';
  }
}

export function voiceErrorForStatus(status: number, statusText: string): VoiceProviderError {
  const message = `ElevenLabs API error: ${status} ${statusText}`;
  if (status === 429) return new VoiceQuotaError(message);
  if (status === 503) return new VoiceUnavailableError(message);
  return new VoiceProviderError(message, status);
}
