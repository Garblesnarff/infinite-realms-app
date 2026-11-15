/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  useVoiceProcessing,
  clearVoiceSegmentAudioCache,
  VOICE_PREPARE_TIMEOUT_MS,
  VOICE_PREPARE_TIMEOUT_MESSAGE,
  STANDARD_FALLBACK_NOTICE_TITLE,
} from '../use-voice-processing';

import { VoiceDirector } from '@/services/voice-director';

vi.mock('@/services/voice-director', () => ({
  VoiceDirector: {
    generateAudio: vi.fn(),
    validateAISegments: vi.fn(),
    processAISegments: vi.fn(),
    castAISegments: vi.fn(async (segments) => segments),
    processPlainText: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const AI_SEGMENTS = [{ type: 'dm', text: 'Previously, on the old road.' }];
const VOICE_SEGMENTS = [{ character: 'DM', text: 'Previously, on the old road.' }];

function makeProps(mockSetState: ReturnType<typeof vi.fn>, mockToast: ReturnType<typeof vi.fn>) {
  return {
    state: {
      isVoiceEnabled: true,
      isProcessing: false,
      isPlaying: false,
      isPaused: false,
      isStalled: false,
      segments: [],
      currentSegmentIndex: -1,
    } as any,
    setState: mockSetState,
    toast: mockToast,
    playAudioSegment: vi.fn(async () => {}),
    initializeAudioContext: vi.fn(() => null),
    stopPlayback: vi.fn(),
    baseResumePlayback: vi.fn(async () => false),
    currentAudio: { current: null } as any,
  };
}

describe('useVoiceProcessing prepare timeout (#1348)', () => {
  let mockSetState: ReturnType<typeof vi.fn>;
  let mockToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearVoiceSegmentAudioCache();
    mockSetState = vi.fn();
    mockToast = vi.fn();
    (VoiceDirector.validateAISegments as any).mockReturnValue(AI_SEGMENTS);
    (VoiceDirector.processAISegments as any).mockReturnValue(VOICE_SEGMENTS);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancels a prepare that runs longer than the named timeout, with a clear message', async () => {
    const signals: AbortSignal[] = [];
    // A provider call that never answers.
    (VoiceDirector.generateAudio as any).mockImplementation(
      (_segment: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() => useVoiceProcessing(makeProps(mockSetState, mockToast)));

    await act(async () => {
      void result.current.speakAISegments(AI_SEGMENTS as any);
      await vi.advanceTimersByTimeAsync(VOICE_PREPARE_TIMEOUT_MS - 1);
    });
    expect(signals[0]?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(signals[0]?.aborted).toBe(true);
    const updates = mockSetState.mock.calls.map(([update]) =>
      typeof update === 'function'
        ? update({ segments: VOICE_SEGMENTS, isProcessing: true })
        : update,
    );
    expect(updates.some((u) => u.error === VOICE_PREPARE_TIMEOUT_MESSAGE)).toBe(true);
    expect(updates.some((u) => u.error === 'Voice unavailable for this message')).toBe(false);
    expect(updates.at(-1)?.isProcessing).toBe(false);
  });

  it('announces the premium-to-Standard fallback once per session, not once per segment', async () => {
    // Premium is expected, but each clip comes back from Standard (kokoro).
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      character: 'DM',
      text: 'Previously, on the old road.',
      audioUrl: 'blob:standard-1',
      provider: 'kokoro',
    });

    const { result } = renderHook(() => useVoiceProcessing(makeProps(mockSetState, mockToast)));

    await act(async () => {
      await result.current.speakAISegments(AI_SEGMENTS as any);
    });
    await act(async () => {
      await result.current.speakAISegments(AI_SEGMENTS as any);
    });

    const notices = mockToast.mock.calls.filter(
      ([props]) => props?.title === STANDARD_FALLBACK_NOTICE_TITLE,
    );
    expect(STANDARD_FALLBACK_NOTICE_TITLE).toBe('Using the standard voice');
    expect(notices).toHaveLength(1);
  });
});
