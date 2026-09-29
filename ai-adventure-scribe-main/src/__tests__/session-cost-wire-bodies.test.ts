/**
 * #2269: in-session voice and scene images send `sessionId`, so the server's `ai_usage` rows
 * carry the session (#2242). Portraits and campaign covers have no session and send none.
 *
 * Only `fetch` is stubbed. Each test drives the real client code from its public entry point and
 * compares the body that reaches `fetch` with the shared fixture the server tests post through
 * the real routes (`server-bun/src/routes/v1/__tests__/session-cost-wire-bodies.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COST_IMAGE_MODEL,
  COST_IMAGE_PROMPT,
  COST_IMAGE_REFERENCE,
  COST_SESSION_ID,
  COST_VOICE_ID,
  COST_VOICE_SETTINGS,
  COST_VOICE_TEXT,
  PORTRAIT_IMAGE_WITHOUT_SESSION,
  SCENE_IMAGE_IN_SESSION,
  VOICE_IN_SESSION,
  VOICE_WITHOUT_SESSION,
} from '../../shared/test-fixtures/session-cost-wire-bodies';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer jwt' })),
  loadCachedSession: vi.fn(() => null),
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));

import { buildSceneImageRequest } from '@/features/game-session/components/chat/message-list/buildSceneImageRequest';
import { openRouterService } from '@/services/openrouter-service';
import { generateSceneImage } from '@/services/scene-image-generator';
import { ElevenLabsProvider } from '@/services/voice/elevenlabs-provider';
import { VoiceAudioService } from '@/services/voice/voice-audio-service';

const AVATAR_URL = 'https://cdn.example.com/avatar.png';

type Posted = { url: string; body: Record<string, unknown> };

let posted: Posted[];

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === AVATAR_URL) {
    // "hello": COST_IMAGE_REFERENCE once base64-encoded.
    // A plain object so `blob()` yields jsdom's Blob, which jsdom's FileReader can read.
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      blob: async () => new Blob(['hello'], { type: 'image/png' }),
    } as unknown as Response;
  }
  posted.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
  if (url.includes('/v1/images/generate')) {
    return new Response(JSON.stringify({ image: 'AAAA' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
});

beforeEach(() => {
  posted = [];
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/audio');
  VoiceAudioService.clearAudioCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('scene images (#2269)', () => {
  it('posts sessionId with the image request', async () => {
    await openRouterService.generateImage({
      prompt: COST_IMAGE_PROMPT,
      model: COST_IMAGE_MODEL,
      referenceImages: [COST_IMAGE_REFERENCE],
      quality: 'low',
      sessionId: COST_SESSION_ID,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toContain(SCENE_IMAGE_IN_SESSION.path);
    expect(posted[0]?.body).toEqual(SCENE_IMAGE_IN_SESSION.wireBody);
  });

  it('sends no sessionId for a portrait or a campaign cover', async () => {
    await openRouterService.generateImage({
      prompt: COST_IMAGE_PROMPT,
      model: COST_IMAGE_MODEL,
      referenceImages: [COST_IMAGE_REFERENCE],
      quality: 'low',
    });

    expect(posted[0]?.body).toEqual(PORTRAIT_IMAGE_WITHOUT_SESSION.wireBody);
    expect(posted[0]?.body).not.toHaveProperty('sessionId');
  });

  it('carries the session from a scene request all the way to the wire', async () => {
    vi.spyOn(openRouterService, 'uploadImage').mockResolvedValue('https://cdn.example.com/s.png');

    await generateSceneImage({
      sceneText: 'A lantern-lit corridor.',
      referenceImageUrl: AVATAR_URL,
      model: COST_IMAGE_MODEL,
      quality: 'low',
      sessionId: COST_SESSION_ID,
    });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toEqual({
      ...SCENE_IMAGE_IN_SESSION.wireBody,
      prompt: expect.stringContaining('Scene: A lantern-lit corridor.'),
    });
  });

  it('builds a scene request that holds the session, and one that does not when there is none', () => {
    const base = {
      sceneText: 'A corridor.',
      campaign: null,
      character: null,
      assetUrls: [],
      label: 'scene',
      quality: 'low' as const,
      model: COST_IMAGE_MODEL,
    };

    expect(buildSceneImageRequest({ ...base, sessionId: COST_SESSION_ID }).sessionId).toBe(
      COST_SESSION_ID,
    );
    expect(buildSceneImageRequest(base).sessionId).toBeUndefined();
  });
});

describe('in-session voice (#2269)', () => {
  const voice = { category: 'narrator', voiceId: COST_VOICE_ID };

  it('ElevenLabsProvider posts sessionId with the synthesis request', async () => {
    await ElevenLabsProvider.generateAudio(
      COST_VOICE_TEXT,
      voice,
      COST_VOICE_SETTINGS,
      undefined,
      COST_SESSION_ID,
    );

    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toContain(VOICE_IN_SESSION.path);
    expect(posted[0]?.body).toEqual(VOICE_IN_SESSION.wireBody);
  });

  it('ElevenLabsProvider sends no sessionId outside a session', async () => {
    await ElevenLabsProvider.generateAudio(COST_VOICE_TEXT, voice, COST_VOICE_SETTINGS);

    expect(posted[0]?.body).toEqual(VOICE_WITHOUT_SESSION.wireBody);
    expect(posted[0]?.body).not.toHaveProperty('sessionId');
  });

  it('VoiceAudioService hands the session to the provider', async () => {
    const generated = await VoiceAudioService.generateAudio(
      {
        voiceId: COST_VOICE_ID,
        text: COST_VOICE_TEXT,
        character: 'Narrator',
        voiceSettings: COST_VOICE_SETTINGS,
      } as Parameters<typeof VoiceAudioService.generateAudio>[0],
      undefined,
      COST_SESSION_ID,
    );

    expect(generated.error).toBeUndefined();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toContain(VOICE_IN_SESSION.path);
    expect(posted[0]?.body).toEqual(VOICE_IN_SESSION.wireBody);
  });
});
