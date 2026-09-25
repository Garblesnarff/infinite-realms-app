/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ElevenLabsProvider } from '../elevenlabs-provider';
import {
  VoiceProviderError,
  VoiceQuotaError,
  VoiceUnavailableError,
  voiceErrorForStatus,
} from '../voice-provider';

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer jwt' })),
}));

describe('voiceErrorForStatus', () => {
  it('429 is a quota error', () => {
    const error = voiceErrorForStatus(429, 'Too Many Requests');
    expect(error).toBeInstanceOf(VoiceQuotaError);
    expect(error.status).toBe(429);
    expect(error.message).toBe('ElevenLabs API error: 429 Too Many Requests');
  });

  it('503 is an unavailable error', () => {
    const error = voiceErrorForStatus(503, 'Service Unavailable');
    expect(error).toBeInstanceOf(VoiceUnavailableError);
    expect(error).not.toBeInstanceOf(VoiceQuotaError);
    expect(error.status).toBe(503);
  });

  it.each([400, 401, 500, 502])('%i is a plain provider error', (status) => {
    const error = voiceErrorForStatus(status, 'x');
    expect(error).toBeInstanceOf(VoiceProviderError);
    expect(error).not.toBeInstanceOf(VoiceQuotaError);
    expect(error).not.toBeInstanceOf(VoiceUnavailableError);
    expect(error.status).toBe(status);
  });
});

describe('ElevenLabsProvider', () => {
  const voice = { category: 'narrator', voiceId: 'T0GKiSwCb51L7pv1sshd' };
  const settings = { stability: 0.5, similarity_boost: 0.75 };

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
    global.URL.createObjectURL = vi.fn(() => 'blob:premium');
  });

  it('keeps the proxy request shape and uses the ElevenLabs voice id', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
    });

    const result = await ElevenLabsProvider.generateAudio('Hello', voice, settings);

    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toContain('/v1/ai-proxy/voice/T0GKiSwCb51L7pv1sshd');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      text: 'Hello',
      model_id: 'eleven_flash_v2_5',
      voice_settings: settings,
    });
    expect(result.audioBlob.type).toBe('audio/mpeg');
    expect(ElevenLabsProvider.resolveVoiceId(voice)).toBe('T0GKiSwCb51L7pv1sshd');
  });

  it.each([
    [429, VoiceQuotaError],
    [503, VoiceUnavailableError],
    [500, VoiceProviderError],
  ])('throws a typed error for %i', async (status, ErrorClass) => {
    (global.fetch as any).mockResolvedValue({ ok: false, status, statusText: 'x' });

    await expect(ElevenLabsProvider.generateAudio('Hello', voice, settings)).rejects.toBeInstanceOf(
      ErrorClass,
    );
  });
});
