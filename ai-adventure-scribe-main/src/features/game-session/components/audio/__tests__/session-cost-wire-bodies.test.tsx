/**
 * #2269: VoiceProvider, mounted by GameProviders with the session id, sends `sessionId` with the
 * voice request. It reaches the route through the progressive-voice hooks; the voice id and
 * settings come from the voice director, so its body is checked against the fixture's keys and
 * its `sessionId`, text and model. Only `fetch` and audio playback are stubbed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COST_SESSION_ID,
  COST_VOICE_TEXT,
  VOICE_IN_SESSION,
} from '../../../../../../shared/test-fixtures/session-cost-wire-bodies';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer jwt' })),
}));

import { VoiceProvider, useVoiceContext } from '@/contexts/VoiceContext';

type Posted = { url: string; body: Record<string, unknown> };

let posted: Posted[];

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  posted.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' },
  });
});

class FakeAudio {
  src = '';
  volume = 1;
  muted = false;
  paused = false;
  currentTime = 0;
  onended: (() => void) | null = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  load = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

beforeEach(() => {
  posted = [];
  fetchStub.mockClear();
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/audio');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VoiceProvider (#2269)', () => {
  const Speaker: React.FC = () => {
    const { playMessage } = useVoiceContext();
    return (
      <button type="button" onClick={() => playMessage('message-1', COST_VOICE_TEXT)}>
        speak
      </button>
    );
  };

  it('carries the session it is mounted with into the voice request', async () => {
    render(
      <VoiceProvider sessionId={COST_SESSION_ID}>
        <Speaker />
      </VoiceProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'speak' }));
    });

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const { body, url } = posted[0] as Posted;
    expect(url).toContain('/v1/ai-proxy/voice/');
    expect(Object.keys(body).sort()).toEqual(Object.keys(VOICE_IN_SESSION.wireBody).sort());
    expect(body.sessionId).toBe(COST_SESSION_ID);
    expect(body.text).toBe(VOICE_IN_SESSION.wireBody.text);
    expect(body.model_id).toBe(VOICE_IN_SESSION.wireBody.model_id);
  });
});
