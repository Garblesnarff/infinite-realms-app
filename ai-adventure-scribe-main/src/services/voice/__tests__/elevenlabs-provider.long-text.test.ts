import { describe, it, expect, vi, beforeEach } from 'vitest';

import { buildVoiceRequestBodies, VOICE_REQUEST_TEXT_MAX } from '../../../../shared/voice-request';
import { ElevenLabsProvider } from '../elevenlabs-provider';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { ELEVENLABS_MODEL } from '@/services/voice-routing';

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: vi.fn(),
  isNetworkError: vi.fn(() => false),
}));

const VOICE_ID = 'T0GKiSwCb51L7pv1sshd';
const SETTINGS = { stability: 0.5, similarity_boost: 0.75 };

// An older DM message: a "Previously, on..." recap longer than the route accepts (#1348).
const LONG_RECAP = Array.from(
  { length: 240 },
  (_, i) => `Sentence ${i} of the recap tells of the old road and the lantern.`,
).join(' ');

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
}

describe('ElevenLabsProvider long text (#1348)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no object URLs; the provider only needs a string back.
    URL.createObjectURL = vi.fn(() => 'blob:test-clip');
    vi.mocked(fetchWithAuth).mockImplementation(async () => audioResponse());
  });

  it('keeps the route text limit at 5000 characters, the value tts.ts enforces', () => {
    expect(VOICE_REQUEST_TEXT_MAX).toBe(5000);
  });

  it('sends a long older DM recap as requests the route accepts, with the exact bodies built for it', async () => {
    expect(LONG_RECAP.length).toBeGreaterThan(VOICE_REQUEST_TEXT_MAX);

    const result = await ElevenLabsProvider.generateAudio(
      LONG_RECAP,
      { category: 'dm', voiceId: VOICE_ID },
      SETTINGS,
      undefined,
      'session-1',
    );

    const sent = vi
      .mocked(fetchWithAuth)
      .mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

    expect(sent.length).toBeGreaterThan(1);
    for (const body of sent) {
      expect(String(body.text).length).toBeLessThanOrEqual(VOICE_REQUEST_TEXT_MAX);
    }
    expect(sent.map((body) => String(body.text)).join('')).toBe(LONG_RECAP);
    expect(sent).toEqual(
      buildVoiceRequestBodies(LONG_RECAP, {
        model_id: ELEVENLABS_MODEL,
        voice_settings: SETTINGS,
        sessionId: 'session-1',
      }),
    );
    expect(result.audioBlob.size).toBe(sent.length * 3);
  });

  it('sends a short message as one request with the unchanged body shape', async () => {
    await ElevenLabsProvider.generateAudio(
      'The lantern flickers.',
      { category: 'dm', voiceId: VOICE_ID },
      SETTINGS,
      undefined,
      'session-1',
    );

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetchWithAuth).mock.calls[0][1]?.body));
    expect(body).toEqual({
      text: 'The lantern flickers.',
      model_id: ELEVENLABS_MODEL,
      voice_settings: SETTINGS,
      sessionId: 'session-1',
    });
  });
});
