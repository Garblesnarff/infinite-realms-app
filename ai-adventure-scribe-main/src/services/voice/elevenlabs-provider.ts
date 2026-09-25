import { ELEVENLABS_MODEL } from '../voice-routing';
import { type VoiceProvider, voiceErrorForStatus } from './voice-provider';

import { getAuthHeaders } from '@/services/auth/TokenService';

/**
 * Premium voice: ElevenLabs through the server proxy. Request shape is
 * unchanged from the pre-provider VoiceAudioService; only the error is typed.
 */
export const ElevenLabsProvider: VoiceProvider = {
  id: 'elevenlabs',

  resolveVoiceId(voice) {
    return voice.voiceId;
  },

  async generateAudio(text, voice, settings, signal) {
    const apiBase = import.meta.env.VITE_API_URL || '';
    const response = await fetch(
      `${apiBase}/v1/ai-proxy/voice/${encodeURIComponent(voice.voiceId)}`,
      {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        signal,
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: settings,
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
