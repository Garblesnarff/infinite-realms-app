import { irVoice } from '../../../shared/npc-voices';
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
    const response = await fetchWithAuth(
      `/v1/ai-proxy/voice/${encodeURIComponent(ElevenLabsProvider.resolveVoiceId(voice))}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
        },
        signal,
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: settings,
          sessionId,
        }),
      },
    );

    if (!response.ok) {
      throw voiceErrorForStatus(response.status, response.statusText);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
    return { audioBlob, audioUrl: URL.createObjectURL(audioBlob) };
  },
};
