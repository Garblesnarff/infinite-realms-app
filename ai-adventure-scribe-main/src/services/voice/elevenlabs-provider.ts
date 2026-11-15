import { irVoice } from '../../../shared/npc-voices';
import { buildVoiceRequestBodies } from '../../../shared/voice-request';
import { ELEVENLABS_MODEL } from '../voice-routing';
import { type VoiceProvider, voiceErrorForStatus } from './voice-provider';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

/**
 * Premium voice: ElevenLabs through the server proxy. Request shape is
 * unchanged from the pre-provider VoiceAudioService; only the error is typed.
 */
export const ElevenLabsProvider: VoiceProvider = {
  id: 'elevenlabs',

  resolveVoiceId(voice) {
    return irVoice(voice.voiceId)?.premium ?? voice.voiceId;
  },

  async generateAudio(text, voice, settings, signal, sessionId) {
    const path = `/v1/ai-proxy/voice/${encodeURIComponent(ElevenLabsProvider.resolveVoiceId(voice))}`;
    // The proxy takes at most VOICE_REQUEST_TEXT_MAX characters per request (#1348),
    // so a longer message goes as several requests, played back as one clip.
    const parts: ArrayBuffer[] = [];
    for (const body of buildVoiceRequestBodies(text, {
      model_id: ELEVENLABS_MODEL,
      voice_settings: settings,
      sessionId,
    })) {
      const response = await fetchWithAuth(path, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw voiceErrorForStatus(response.status, response.statusText);
      }

      parts.push(await response.arrayBuffer());
    }

    const audioBlob = new Blob(parts, { type: 'audio/mpeg' });
    return { audioBlob, audioUrl: URL.createObjectURL(audioBlob) };
  },
};
