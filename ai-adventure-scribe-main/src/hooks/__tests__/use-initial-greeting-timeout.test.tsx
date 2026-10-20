import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GREETING_STALL_TIMEOUT_MS, useInitialGreeting } from '../use-initial-greeting';

const { listSessionMessages, getCharacter, getCampaign, generateOpeningMessage } = vi.hoisted(
  () => ({
    listSessionMessages: vi.fn(),
    getCharacter: vi.fn(),
    getCampaign: vi.fn(),
    generateOpeningMessage: vi.fn(),
  }),
);

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages,
    listMemories: vi.fn().mockResolvedValue([]),
    updateMemoryContent: vi.fn(),
    getCharacter,
    getCampaign,
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { generateOpeningMessage },
}));
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi
      .fn()
      .mockResolvedValue(
        'A. **Look around**, survey your surroundings.\nB. **Press on**, continue toward your goal.\nC. **Call out**, announce your presence.',
      ),
  },
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const OPENING_TEXT =
  'The real opening scene unfolds beneath a copper sky as the first watch bell echoes across the valley.';
const LATE_TEXT =
  'A completely different opening scene that the superseded first attempt produced far too late to be shown to anyone.';

const neverSettles = (): Promise<string> => new Promise<string>(() => {});

describe('useInitialGreeting stall watchdog (#865)', () => {
  const onGreetingGenerated = vi.fn().mockResolvedValue(undefined);

  const props = {
    sessionId: 'session-id',
    sessionData: { turn_count: 0 },
    characterId: 'character-id',
    campaignId: 'campaign-id',
    messages: [],
    messagesLoading: false,
    onGreetingGenerated,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    onGreetingGenerated.mockResolvedValue(undefined);
    listSessionMessages.mockResolvedValue({ total: 0, messages: [] });
    getCharacter.mockResolvedValue({ id: 'character-id', name: 'Hero', class: 'Cleric', level: 1 });
    getCampaign.mockResolvedValue({ id: 'campaign-id', name: 'The Eternal Feast' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags the wait as timed out when generation never settles', async () => {
    generateOpeningMessage.mockImplementation(neverSettles);

    const { result } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});

    expect(result.current.isGenerating).toBe(true);
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });

    expect(result.current.isGenerating).toBe(true);
    expect(result.current.timedOut).toBe(true);
    expect(onGreetingGenerated).not.toHaveBeenCalled();
  });

  it('retry re-requests the scene and the retried generation lands', async () => {
    generateOpeningMessage
      .mockImplementationOnce(neverSettles)
      .mockResolvedValue(OPENING_TEXT);

    const { result } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);

    act(() => {
      result.current.retry();
    });
    await act(async () => {});
    await act(async () => {});

    expect(generateOpeningMessage).toHaveBeenCalledTimes(2);
    expect(onGreetingGenerated).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining(OPENING_TEXT) }),
    );
    expect(result.current.hasGenerated).toBe(true);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.timedOut).toBe(false);
  });

  it('re-arms the deadline when the retried attempt also stalls', async () => {
    generateOpeningMessage.mockImplementation(neverSettles);

    const { result } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);

    act(() => {
      result.current.retry();
    });
    await act(async () => {});
    expect(result.current.timedOut).toBe(false);
    expect(result.current.isGenerating).toBe(true);

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);
  });

  it('a superseded attempt that resolves late delivers nothing — no second scene, no duplicate memories', async () => {
    let resolveFirst!: (value: string) => void;
    const firstAttempt = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    generateOpeningMessage.mockImplementationOnce(() => firstAttempt);
    generateOpeningMessage.mockResolvedValue(OPENING_TEXT);
    const onMemoryCreated = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useInitialGreeting({ ...props, onMemoryCreated }));
    await act(async () => {});

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });
    expect(result.current.timedOut).toBe(true);

    // The retry supersedes the in-flight attempt and delivers its scene.
    act(() => {
      result.current.retry();
    });
    await act(async () => {});
    await act(async () => {});

    expect(onGreetingGenerated).toHaveBeenCalledTimes(1);
    expect(onGreetingGenerated.mock.calls[0][0].text).toContain(OPENING_TEXT);
    const memoriesAfterRetry = onMemoryCreated.mock.calls.length;
    expect(memoriesAfterRetry).toBeGreaterThan(0);

    // The original attempt finally resolves — with a DIFFERENT scene. It
    // must be discarded entirely: no second greeting, no second memory set.
    await act(async () => {
      resolveFirst(LATE_TEXT);
    });
    await act(async () => {});

    expect(onGreetingGenerated).toHaveBeenCalledTimes(1);
    expect(onMemoryCreated).toHaveBeenCalledTimes(memoriesAfterRetry);
    expect(result.current.hasGenerated).toBe(true);
  });

  it('a superseded attempt that fails late posts no fallback greeting after the retry scene', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstAttempt = new Promise<string>((_resolve, reject) => {
      rejectFirst = reject;
    });
    generateOpeningMessage.mockImplementationOnce(() => firstAttempt);
    generateOpeningMessage.mockResolvedValue(OPENING_TEXT);

    const { result } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS);
    });
    act(() => {
      result.current.retry();
    });
    await act(async () => {});
    await act(async () => {});
    expect(onGreetingGenerated).toHaveBeenCalledTimes(1);

    // The original attempt now fails (e.g. its transport timeout fires).
    // Its fallback greeting must not land after the retry's real scene.
    await act(async () => {
      rejectFirst(new Error('transport timeout'));
    });
    await act(async () => {});

    expect(onGreetingGenerated).toHaveBeenCalledTimes(1);
    expect(onGreetingGenerated.mock.calls[0][0].text).toContain(OPENING_TEXT);
  });

  it('unmounting disarms the watchdog — no extra generations afterwards', async () => {
    generateOpeningMessage.mockImplementation(neverSettles);

    const { unmount } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});
    unmount();

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS * 2);
    });
    expect(generateOpeningMessage).toHaveBeenCalledTimes(1);
  });

  it('never flags a timeout on the happy path', async () => {
    generateOpeningMessage.mockResolvedValue(OPENING_TEXT);

    const { result } = renderHook(() => useInitialGreeting(props));
    await act(async () => {});
    await act(async () => {});

    expect(result.current.hasGenerated).toBe(true);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.timedOut).toBe(false);

    act(() => {
      vi.advanceTimersByTime(GREETING_STALL_TIMEOUT_MS * 2);
    });
    expect(result.current.timedOut).toBe(false);
  });
});
