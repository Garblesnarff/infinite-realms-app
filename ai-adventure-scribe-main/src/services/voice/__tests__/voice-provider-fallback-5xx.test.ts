/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KokoroProvider, resolveStandardEngine } from '../kokoro-provider';
import { VoiceAudioService } from '../voice-audio-service';
import { getVoiceModeStatus, reloadVoiceModeStatus } from '../voice-mode-store';

import type { VoiceSegment } from '@/services/voice-routing';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
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

describe('VoiceAudioService premium 5xx / network fallback (#1348)', () => {
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

  it('falls back to Standard for this segment only on premium 502, without switching the session', async () => {
    premiumResponds(502, 'Bad Gateway');

    const first = await VoiceAudioService.generateAudio(segment);

    expect(first.provider).toBe('kokoro');
    expect(first.error).toBeUndefined();
    expect(first.audioUrl).toBe('blob:kokoro');
    // No session toggle: the setting and the fallback flag are untouched.
    expect(getVoiceModeStatus().fallbackReason).toBeNull();
    expect(window.sessionStorage.getItem('progressive-voice-premium-fallback')).toBeNull();

    // The next segment retries premium: the fallback covered one segment, not the session.
    premiumResponds(200);
    const second = await VoiceAudioService.generateAudio({ ...segment, text: 'And the silver.' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(second.provider).toBe('elevenlabs');
  });

  it('falls back to Standard for this segment only on other premium 5xx', async () => {
    for (const [status, text] of [
      [500, 'First 5xx segment.'],
      [504, 'Second 5xx segment.'],
    ] as const) {
      premiumResponds(status, 'Server Error');
      const result = await VoiceAudioService.generateAudio({ ...segment, text });
      expect(result.provider).toBe('kokoro');
      expect(result.error).toBeUndefined();
      expect(getVoiceModeStatus().fallbackReason).toBeNull();
    }
  });

  it('falls back to Standard for this segment only on a premium network failure', async () => {
    // The transport retries a failed fetch for 20 s before surfacing it, so
    // this test runs on fake timers past the retry budget (the 30 s route
    // timeout does not fire first).
    vi.useFakeTimers();
    try {
      (global.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));
      const pending = VoiceAudioService.generateAudio(segment);
      await vi.advanceTimersByTimeAsync(25_000);
      const first = await pending;

      expect(first.provider).toBe('kokoro');
      expect(first.error).toBeUndefined();
      expect(getVoiceModeStatus().fallbackReason).toBeNull();
      // The transport retried before surfacing the failure: more than one
      // premium attempt happened, so the fallback did not fire immediately.
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }

    premiumResponds(200);
    const second = await VoiceAudioService.generateAudio({ ...segment, text: 'And the silver.' });
    expect(second.provider).toBe('elevenlabs');
  });

  it('does not loop back to premium when Standard also fails after a fallback', async () => {
    premiumResponds(502, 'Bad Gateway');
    vi.mocked(KokoroProvider.generateAudio).mockRejectedValueOnce(new Error('Kokoro boom'));

    const result = await VoiceAudioService.generateAudio(segment);

    expect(result.error).toBe('Kokoro boom');
    expect(result.audioUrl).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getVoiceModeStatus().fallbackReason).toBeNull();
  });
});
