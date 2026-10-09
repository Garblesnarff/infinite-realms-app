/**
 * #2676 step 5: voice sends the app's own access token, the same one the rest of the client
 * sends (TokenService, localStorage `workos_access_token`), and the clip plays.
 *
 * The voice route is mocked at fetch. TokenService is NOT mocked, so the header comes from the
 * same source every other request uses. The test records the Authorization header the route sees.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { VoiceProvider, useVoiceContext } from '@/contexts/VoiceContext';

const APP_TOKEN = 'app-workos-access-token';
const MESSAGE_TEXT = 'The lantern flickers.';

type Seen = { url: string; authorization: string | null };

let seen: Seen[] = [];
const audioElements: FakeAudio[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  seen.push({ url: String(input), authorization: headers.get('Authorization') });
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
  // A real element fires `loadeddata` once a clip has loaded; the hook starts playback from it.
  private listeners: Record<string, Array<() => void>> = {};
  addEventListener = vi.fn((type: string, listener: () => void) => {
    (this.listeners[type] ??= []).push(listener);
  });
  removeEventListener = vi.fn();
  load = vi.fn(() => {
    queueMicrotask(() => this.listeners.loadeddata?.forEach((listener) => listener()));
  });

  constructor() {
    audioElements.push(this);
  }
}

beforeEach(() => {
  seen = [];
  audioElements.length = 0;
  fetchStub.mockClear();
  window.localStorage.setItem('workos_access_token', APP_TOKEN);
  if (!('speechSynthesis' in window)) {
    Object.defineProperty(window, 'speechSynthesis', {
      value: {},
      configurable: true,
      writable: true,
    });
  }
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('Audio', FakeAudio);
  URL.createObjectURL = vi.fn(() => 'blob:http://localhost/audio');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  // Unmount before restoring: the provider's cleanup still calls URL.revokeObjectURL.
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('workos_access_token');
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('VoiceContext sends the app token (#2676 step 5)', () => {
  it('plays a clip against the voice route with the app token in Authorization', async () => {
    const Speaker: React.FC = () => {
      const { playMessage } = useVoiceContext();
      return (
        <button type="button" onClick={() => playMessage('message-1', MESSAGE_TEXT)}>
          speak
        </button>
      );
    };

    render(
      <VoiceProvider>
        <Speaker />
      </VoiceProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'speak' }));
    });

    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]?.url).toContain('/v1/ai-proxy/voice/');
    expect(seen[0]?.authorization).toBe(`Bearer ${APP_TOKEN}`);

    await waitFor(() => expect(audioElements[0]?.play).toHaveBeenCalled());
  });
});
