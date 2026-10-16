import { afterEach, describe, expect, it, vi } from 'vitest';

import { IR_VOICES } from '../../../../shared/npc-voices';
import { npcVoiceCastSegments } from '../../../../shared/test-fixtures/npc-voice-cast';
import { VoiceDirector } from '../../voice-director';
import { ElevenLabsProvider } from '../elevenlabs-provider';
import { KokoroProvider } from '../kokoro-provider';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn(async () => {}) }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({}),
  loadCachedSession: () => null,
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());

describe('server casting to provider playback', () => {
  it('sends the narration producer wire shape, preserves IR ids, and excludes the player', async () => {
    const response = npcVoiceCastSegments.map((segment, index) => ({
      ...segment,
      npc_id: index > 0 && index < 4 ? `npc-${index}` : null,
      voice_id: ['narrator', 'nathan', 'sam', 'fena', null][index],
      voice_muted: index === 4,
    }));
    const fetchStub = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(response), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchStub);
    const validated = VoiceDirector.validateAISegments(
      npcVoiceCastSegments.map((s) => ({
        ...s,
        type: s.type === 'character' ? 'character' : 'dm',
        character: s.character ?? undefined,
        voice_category: s.voice_category ?? undefined,
        npc_id: s.npc_id ?? undefined,
      })),
    );
    const cast = await VoiceDirector.castAISegments(validated, 'session-a');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0][0]).toContain('/v1/sessions/session-a/voice-cast');
    const init = (fetchStub.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
    expect(JSON.parse(String(init.body))).toEqual({ segments: npcVoiceCastSegments });
    const playback = VoiceDirector.processAISegments(cast);
    expect(playback).toHaveLength(4);
    expect(playback.map((s) => s.voiceId)).toEqual(['narrator', 'nathan', 'sam', 'fena']);
    expect(playback.some((s) => s.character === 'Player Hero')).toBe(false);
    for (const segment of playback) {
      const ref = { voiceId: segment.voiceId, category: 'merchant' };
      const configured = IR_VOICES[segment.voiceId as keyof typeof IR_VOICES];
      expect(KokoroProvider.resolveVoiceId(ref)).toBe(configured.kokoro);
      expect(ElevenLabsProvider.resolveVoiceId(ref)).toBe(configured.premium);
    }
  });
});
