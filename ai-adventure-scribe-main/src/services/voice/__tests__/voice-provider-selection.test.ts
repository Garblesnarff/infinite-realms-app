/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KokoroProvider, resolveStandardEngine } from '../kokoro-provider';
import { VoiceAudioService } from '../voice-audio-service';
import { getVoiceModeStatus, reloadVoiceModeStatus, setVoiceMode } from '../voice-mode-store';

import type { VoiceSegment } from '@/services/voice-routing';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer jwt' })),
}));

// No worker, no model download: the Kokoro side is a stub.
vi.mock('../kokoro-provider', () => ({
  resolveStandardEngine: vi.fn(async () => 'kokoro'),
  prepareStandardVoice: vi.fn(),
  KokoroProvider: {
    id: 'kokoro',
    resolveVoiceId: vi.fn((voice: { category: string }) => `kokoro-${voice.category}`),
    generateAudio: vi.fn(async () => {
      const audioBlob = new Blob(['wav'], { type: 'audio/wav' });
      return { audioBlob, audioUrl: 'blob:kokoro' };
    }),
  },
}));

global.URL.createObjectURL = vi.fn(() => 'blob:premium');

const segment: VoiceSegment = {
  id: 's1',
  type: 'character',
  text: 'Give me the gold!',
  character: 'Snik',
  voiceId: 'dfZGXKiIzjizWtJ0NgPy',
  voiceName: 'Michael Mouse',
  voiceCategory: 'goblin',
  voiceSettings: { stability: 0.3, similarity_boost: 0.6 },
};

function premiumResponds(status: number, statusText = ''): void {
  (global.fetch as any).mockResolvedValue(
    status === 200
      ? { ok: true, status, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) }
      : { ok: false, status, statusText },
  );
}

describe('VoiceAudioService provider selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    reloadVoiceModeStatus();
    VoiceAudioService.clearAudioCache();
    global.fetch = vi.fn() as unknown as typeof fetch;
    vi.mocked(resolveStandardEngine).mockResolvedValue('kokoro');
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('uses premium (ElevenLabs) by default', async () => {
    premiumResponds(200);

    const result = await VoiceAudioService.generateAudio(segment);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/ai-proxy/voice/dfZGXKiIzjizWtJ0NgPy'),
      expect.anything(),
    );
    expect(KokoroProvider.generateAudio).not.toHaveBeenCalled();
    expect(result.provider).toBe('elevenlabs');
    expect(result.audioUrl).toBe('blob:premium');
  });

  it('uses Standard (Kokoro) when the player setting is Standard, without calling premium', async () => {
    setVoiceMode('standard');
    expect(window.localStorage.getItem('progressive-voice-mode')).toBe('"standard"');

    const result = await VoiceAudioService.generateAudio(segment);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(KokoroProvider.generateAudio).toHaveBeenCalledWith(
      segment.text,
      { category: 'goblin', voiceId: segment.voiceId },
      segment.voiceSettings,
      undefined,
      undefined, // no session outside a game session
    );
    expect(result.provider).toBe('kokoro');
    expect(result.audioUrl).toBe('blob:kokoro');
    expect(result.error).toBeUndefined();
  });

  it('reads the persisted Standard setting on load', async () => {
    window.localStorage.setItem('progressive-voice-mode', '"standard"');
    reloadVoiceModeStatus();

    const result = await VoiceAudioService.generateAudio(segment);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.provider).toBe('kokoro');
  });

  it('falls back to Standard for the session on premium 429 (quota)', async () => {
    premiumResponds(429, 'Too Many Requests');

    const first = await VoiceAudioService.generateAudio(segment);

    expect(first.provider).toBe('kokoro');
    expect(first.error).toBeUndefined();
    expect(getVoiceModeStatus().fallbackReason).toBe('quota');
    expect(window.sessionStorage.getItem('progressive-voice-premium-fallback')).toBe('"quota"');
    // The setting is not overwritten; only this session switches.
    expect(getVoiceModeStatus().mode).toBe('premium');

    // Later segments go straight to Standard: premium is not retried.
    await VoiceAudioService.generateAudio({ ...segment, text: 'And the silver.' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(KokoroProvider.generateAudio).toHaveBeenCalledTimes(2);
  });

  it('falls back to Standard for the session on premium 503 (outage)', async () => {
    premiumResponds(503, 'Service Unavailable');

    const result = await VoiceAudioService.generateAudio(segment);

    expect(result.provider).toBe('kokoro');
    expect(getVoiceModeStatus().fallbackReason).toBe('unavailable');
  });

  it('does not fall back on other premium errors', async () => {
    premiumResponds(500, 'Internal Server Error');

    const result = await VoiceAudioService.generateAudio(segment);

    expect(result.error).toBe('ElevenLabs API error: 500 Internal Server Error');
    expect(result.audioUrl).toBeUndefined();
    expect(KokoroProvider.generateAudio).not.toHaveBeenCalled();
    expect(getVoiceModeStatus().fallbackReason).toBeNull();
  });

  it('choosing Premium again clears the session fallback', async () => {
    premiumResponds(429, 'Too Many Requests');
    await VoiceAudioService.generateAudio(segment);
    expect(getVoiceModeStatus().fallbackReason).toBe('quota');

    setVoiceMode('premium');

    expect(getVoiceModeStatus().fallbackReason).toBeNull();
    expect(window.sessionStorage.getItem('progressive-voice-premium-fallback')).toBeNull();
  });

  it('returns a speechSynthesis segment (no blob) when the device check chose it', async () => {
    setVoiceMode('standard');
    vi.mocked(resolveStandardEngine).mockResolvedValue('speech-synthesis');

    const result = await VoiceAudioService.generateAudio(segment);

    expect(result.provider).toBe('speech-synthesis');
    expect(result.audioUrl).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(KokoroProvider.generateAudio).not.toHaveBeenCalled();
  });

  it('keys the audio cache by provider as well as voice and text', async () => {
    premiumResponds(200);
    await VoiceAudioService.generateAudio(segment);
    setVoiceMode('standard');
    await VoiceAudioService.generateAudio(segment);

    // Same text and character: two entries, one per provider, no cross-serving.
    const { keys } = VoiceAudioService.getAudioCacheStats();
    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.startsWith('elevenlabs:dfZGXKiIzjizWtJ0NgPy_'))).toBe(true);
    expect(keys.some((key) => key.startsWith('kokoro:kokoro-goblin_'))).toBe(true);
    expect(KokoroProvider.generateAudio).toHaveBeenCalledTimes(1);
  });

  it('derives the category from the voice id when a segment has none', async () => {
    setVoiceMode('standard');
    const { voiceCategory: _omit, ...withoutCategory } = segment;

    await VoiceAudioService.generateAudio(withoutCategory);

    expect(KokoroProvider.generateAudio).toHaveBeenCalledWith(
      segment.text,
      { category: 'goblin', voiceId: segment.voiceId },
      segment.voiceSettings,
      undefined,
      undefined, // no session outside a game session
    );
  });
});
