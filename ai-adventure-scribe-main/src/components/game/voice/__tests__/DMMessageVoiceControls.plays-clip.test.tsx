/**
 * #2676 step 3: after the dead voice players were deleted, the path a player uses still plays.
 *
 * DMMessageVoiceControls, inside the real VoiceProvider, sends its message to the voice route and
 * starts the clip it gets back. Only `fetch`, the audio element, logging and auth are stubbed; the
 * route is reached through the real voice hooks, so this breaks if that path breaks.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer jwt' })),
}));

import { DMMessageVoiceControls } from '@/components/game/voice/DMMessageVoiceControls';
import { VoiceProvider } from '@/contexts/VoiceContext';

const MESSAGE_TEXT = 'Hello there.';

type Posted = { url: string; body: Record<string, unknown> };

let posted: Posted[] = [];
const audioElements: FakeAudio[] = [];
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

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
  posted = [];
  audioElements.length = 0;
  fetchStub.mockClear();
  // The component renders only when speech synthesis exists; jsdom has none.
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
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('DMMessageVoiceControls plays a clip (#2676 step 3)', () => {
  it('posts the message to the voice route and starts the clip it gets back', async () => {
    render(
      <VoiceProvider>
        <DMMessageVoiceControls messageId="message-1" messageText={MESSAGE_TEXT} />
      </VoiceProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /play this message/i }));
    });

    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(posted[0]?.url).toContain('/v1/ai-proxy/voice/');
    expect(String(posted[0]?.body.text)).toContain('Hello there');

    await waitFor(() => expect(audioElements.length).toBeGreaterThan(0));
    await waitFor(() => expect(audioElements[0]?.play).toHaveBeenCalled());
  });
});
