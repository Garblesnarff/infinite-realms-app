/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useVoiceProcessing,
  clearVoiceSegmentAudioCache,
  getVoiceSegmentAudioCacheSize,
  hashSegmentText,
  SEGMENT_AUDIO_CACHE_MAX,
} from '../use-voice-processing';

import { logger } from '@/lib/logger';
import { VoiceDirector } from '@/services/voice-director';

// Mock VoiceDirector
vi.mock('@/services/voice-director', () => ({
  VoiceDirector: {
    generateAudio: vi.fn(),
    validateAISegments: vi.fn(),
    processAISegments: vi.fn(),
    processPlainText: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useVoiceProcessing', () => {
  const mockSetState = vi.fn();
  const mockToast = vi.fn();
  const mockPlayAudioSegment = vi.fn();
  const mockInitializeAudioContext = vi.fn();
  const mockStopPlayback = vi.fn();
  const mockBaseResumePlayback = vi.fn();

  const defaultProps = {
    state: {
      isVoiceEnabled: true,
      isProcessing: false,
      isPlaying: false,
      isPaused: false,
      segments: [],
      currentSegmentIndex: -1,
    } as any,
    setState: mockSetState,
    toast: mockToast,
    playAudioSegment: mockPlayAudioSegment,
    initializeAudioContext: mockInitializeAudioContext,
    stopPlayback: mockStopPlayback,
    baseResumePlayback: mockBaseResumePlayback,
    currentAudio: { current: null } as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearVoiceSegmentAudioCache();
    // Ensure default state for each test
    defaultProps.state = {
      isVoiceEnabled: true,
      isProcessing: false,
      isPlaying: false,
      isPaused: false,
      isStalled: false,
      segments: [],
      currentSegmentIndex: -1,
    };
  });

  it('should process segments progressively', async () => {
    const aiSegments = [{ type: 'dm', text: 'Hello', character: 'DM' }];
    const voiceSegments = [{ character: 'DM', text: 'Hello', voice_category: 'dm' }];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...voiceSegments[0],
      audioUrl: 'http://test.com/audio.mp3',
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });

    expect(VoiceDirector.processAISegments).toHaveBeenCalled();
    expect(VoiceDirector.generateAudio).toHaveBeenCalled();
    expect(mockPlayAudioSegment).toHaveBeenCalled();
    expect(mockSetState).toHaveBeenCalledWith(expect.any(Function));
  });

  it('passes the game session to each voice generation (#2269)', async () => {
    const aiSegments = [{ type: 'dm', text: 'Hello', character: 'DM' }];
    const voiceSegments = [{ character: 'DM', text: 'Hello', voice_category: 'dm' }];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...voiceSegments[0],
      audioUrl: 'http://test.com/audio.mp3',
    });

    const { result } = renderHook(() =>
      useVoiceProcessing({ ...defaultProps, sessionId: 'session-2269' }),
    );

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });

    expect(VoiceDirector.generateAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello' }),
      expect.any(AbortSignal),
      'session-2269',
    );
  });

  it('should pass each segment voice ID through generation and playback', async () => {
    const aiSegments = [
      { type: 'dm', text: 'The road is clear.' },
      { type: 'character', text: 'Halt.', character: 'Sergeant Vance' },
    ];
    const voiceSegments = [
      { type: 'dm', character: 'DM', text: 'The road is clear.', voiceId: 'narrator-id' },
      {
        type: 'character',
        character: 'Sergeant Vance',
        text: 'Halt.',
        voiceId: 'guard-id',
      },
    ];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: any) => ({
      ...segment,
      audioUrl: `http://test.com/${segment.voiceId}.mp3`,
    }));

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });

    expect(VoiceDirector.generateAudio).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ voiceId: 'narrator-id' }),
      expect.any(AbortSignal),
      undefined, // no session outside a game session
    );
    expect(VoiceDirector.generateAudio).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ voiceId: 'guard-id' }),
      expect.any(AbortSignal),
      undefined, // no session outside a game session
    );
    expect(mockPlayAudioSegment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ voiceId: 'narrator-id' }),
      0,
    );
    expect(mockPlayAudioSegment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ voiceId: 'guard-id' }),
      1,
    );
  });

  it('should fallback to plain text if segments are not available', async () => {
    const text = 'Fallback text';
    const voiceSegments = [{ character: 'DM', text, voice_category: 'dm' }];

    (VoiceDirector.validateAISegments as any).mockReturnValue([{ type: 'dm', text }]);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...voiceSegments[0],
      audioUrl: 'http://test.com/audio.mp3',
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakPlainText(text);
    });

    expect(VoiceDirector.processPlainText).not.toHaveBeenCalled();
    expect(VoiceDirector.processAISegments).toHaveBeenCalled();
    expect(mockPlayAudioSegment).toHaveBeenCalled();
  });

  it('should not invent speakers when falling back to plain text', async () => {
    const text = 'You press the latch. "Wait," says an unknown npc.';
    const voiceSegments = [{ character: 'DM', text, voiceId: 'narrator-id' }];

    (VoiceDirector.validateAISegments as any).mockReturnValue([
      { type: 'dm', text, character: undefined, voice_category: undefined },
    ]);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...voiceSegments[0],
      audioUrl: 'http://test.com/audio.mp3',
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakPlainText(text);
    });

    expect(VoiceDirector.processPlainText).not.toHaveBeenCalled();
    expect(VoiceDirector.validateAISegments).toHaveBeenCalledWith([
      {
        type: 'dm',
        text,
        character: undefined,
        voice_category: undefined,
      },
    ]);
  });

  it('should handle errors during processing and continue with next segment', async () => {
    const aiSegments = [
      { type: 'dm', text: 'Fail' },
      { type: 'dm', text: 'Success' },
    ];
    const voiceSegments = [
      { character: 'DM', text: 'Fail' },
      { character: 'DM', text: 'Success' },
    ];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);

    (VoiceDirector.generateAudio as any)
      .mockRejectedValueOnce(new Error('Generation Error'))
      .mockResolvedValueOnce({ ...voiceSegments[1], audioUrl: 'http://test.com/2.mp3' });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });

    expect(mockPlayAudioSegment).toHaveBeenCalledTimes(1);
    expect(mockPlayAudioSegment).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Success' }),
      1,
    );
  });

  it('should handle no valid voice segments', async () => {
    (VoiceDirector.validateAISegments as any).mockReturnValue([{ type: 'dm', text: 'test' }]);
    (VoiceDirector.processAISegments as any).mockReturnValue([]);

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'test' }] as any);
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Voice Error',
        description: 'No valid voice segments created',
      }),
    );
  });

  it('should resume playback from current position', async () => {
    const segments = [
      { character: 'DM', text: '1', audioUrl: 'http://test.com/1.mp3' },
      { character: 'DM', text: '2' },
    ];
    const propsWithSegments = {
      ...defaultProps,
      state: {
        ...defaultProps.state,
        segments,
        currentSegmentIndex: 1,
      } as any,
    };

    mockBaseResumePlayback.mockResolvedValue(false);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...segments[1],
      audioUrl: 'http://test.com/2.mp3',
    });

    const { result } = renderHook(() => useVoiceProcessing(propsWithSegments));

    await act(async () => {
      await result.current.resumePlayback();
    });

    expect(mockPlayAudioSegment).toHaveBeenCalledWith(expect.objectContaining({ text: '2' }), 1);
  });

  it('should not resume if already handled by baseResumePlayback', async () => {
    mockBaseResumePlayback.mockResolvedValue(true);
    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.resumePlayback();
    });

    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('should not resume if no segments or invalid index', async () => {
    const propsNoSegments = {
      ...defaultProps,
      state: { ...defaultProps.state, segments: [], currentSegmentIndex: -1 } as any,
    };
    mockBaseResumePlayback.mockResolvedValue(false);
    const { result } = renderHook(() => useVoiceProcessing(propsNoSegments));

    await act(async () => {
      await result.current.resumePlayback();
    });

    expect(mockSetState).not.toHaveBeenCalled();
  });

  it('should not resume if voice is disabled', async () => {
    const propsDisabled = {
      ...defaultProps,
      state: { ...defaultProps.state, isVoiceEnabled: false } as any,
    };

    const { result } = renderHook(() => useVoiceProcessing(propsDisabled));

    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'test' }] as any);
    });

    expect(VoiceDirector.generateAudio).not.toHaveBeenCalled();
  });

  it('should handle audio generation returning error in segment', async () => {
    const aiSegments = [{ type: 'dm', text: 'Error' }];
    const voiceSegments = [{ character: 'DM', text: 'Error' }];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockResolvedValue({
      ...voiceSegments[0],
      error: 'Generation failed',
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });

    expect(mockPlayAudioSegment).not.toHaveBeenCalled();
  });

  it('should abort previous processing when a new request comes in', async () => {
    const aiSegments1 = [{ type: 'dm', text: 'First Request' }];
    const aiSegments2 = [{ type: 'dm', text: 'Second Request' }];
    (VoiceDirector.validateAISegments as any).mockImplementation((segs: any) => segs);
    (VoiceDirector.processAISegments as any).mockImplementation((segs: any) =>
      segs.map((s: any) => ({ character: 'DM', text: s.text })),
    );

    // Slow generation for first request
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: any) => {
      if (segment.text === 'First Request') {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { ...segment, audioUrl: `http://test.com/${segment.text}.mp3` };
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    let firstCall: Promise<void>;
    act(() => {
      firstCall = result.current.speakAISegments(aiSegments1 as any);
    });

    // Short delay to ensure it starts
    await new Promise((resolve) => setTimeout(resolve, 20));

    await act(async () => {
      await result.current.speakAISegments(aiSegments2 as any);
    });

    await firstCall;

    // This checks that VoiceDirector.generateAudio was called for the second request
    expect(VoiceDirector.generateAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Second Request' }),
      expect.any(AbortSignal),
      undefined, // no session outside a game session
    );
  });

  it('should not continue loop if aborted', async () => {
    const aiSegments1 = [
      { type: 'dm', text: '1.1' },
      { type: 'dm', text: '1.2' },
    ];
    const voiceSegments1 = [
      { character: 'DM', text: '1.1' },
      { character: 'DM', text: '1.2' },
    ];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments1);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments1);

    (VoiceDirector.generateAudio as any).mockImplementation(
      async (segment: any, signal?: AbortSignal) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ ...segment, audioUrl: `http://test.com/${segment.text}.mp3` }),
            50,
          );
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    );

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    let firstCall: Promise<void>;
    act(() => {
      firstCall = result.current.speakAISegments(aiSegments1 as any);
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Abort manually via the controller
    act(() => {
      result.current.abortController.current?.abort();
    });

    await firstCall;

    expect(VoiceDirector.generateAudio).toHaveBeenCalledWith(
      expect.objectContaining({ text: '1.1' }),
      expect.any(AbortSignal),
      undefined, // no session outside a game session
    );
    expect(result.current.abortController.current?.signal.aborted).toBe(true);
    expect(mockPlayAudioSegment).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: '1.2' }),
      expect.anything(),
    );
  });

  it('preserves playback order and logs VOICE_SEGMENT_STALL when the next segment is late', async () => {
    const aiSegments = [
      { type: 'dm', text: 'one' },
      { type: 'character', text: 'two', character: 'Professor' },
      { type: 'dm', text: 'three' },
    ];
    const voiceSegments = [
      { character: 'DM', text: 'one', voiceId: 'narrator' },
      { character: 'Professor', text: 'two', voiceId: 'villain_male' },
      { character: 'DM', text: 'three', voiceId: 'narrator' },
    ];

    let resolveTwo: (value: unknown) => void = () => undefined;
    const twoReady = new Promise((resolve) => {
      resolveTwo = resolve;
    });

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: { text: string }) => {
      if (segment.text === 'two') {
        return twoReady;
      }
      return { ...segment, audioUrl: `http://test.com/${segment.text}.mp3` };
    });

    const playOrder: string[] = [];
    mockPlayAudioSegment.mockImplementation(async (segment: { text: string }) => {
      playOrder.push(segment.text);
    });

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    let finished: Promise<void> = Promise.resolve();
    await act(async () => {
      finished = result.current.speakAISegments(aiSegments as any);
    });

    await vi.waitFor(() => {
      expect(playOrder).toEqual(['one']);
    });

    await act(async () => {
      resolveTwo({ ...voiceSegments[1], audioUrl: 'http://test.com/two.mp3' });
      await finished;
    });

    expect(playOrder).toEqual(['one', 'two', 'three']);
    expect(logger.info).toHaveBeenCalledWith(
      'VOICE_SEGMENT_STALL',
      expect.objectContaining({ index: 1, waitMs: expect.any(Number) }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'VOICE_SEGMENT_TIMING',
      expect.objectContaining({
        index: 0,
        voice: expect.anything(),
        requestMs: expect.any(Number),
        readyMs: expect.any(Number),
        gapMs: expect.any(Number),
      }),
    );
  });

  it('replays cached segments without fetching again', async () => {
    const aiSegments = [
      { type: 'dm', text: 'alpha' },
      { type: 'character', text: 'beta', character: 'Professor' },
      { type: 'dm', text: 'gamma' },
    ];
    const voiceSegments = [
      { character: 'DM', text: 'alpha', voiceId: 'narrator' },
      { character: 'Professor', text: 'beta', voiceId: 'villain_male' },
      { character: 'DM', text: 'gamma', voiceId: 'narrator' },
    ];

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: { text: string }) => ({
      ...segment,
      audioUrl: `http://test.com/${segment.text}.mp3`,
    }));
    mockPlayAudioSegment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(3);

    defaultProps.state.isProcessing = false;
    await act(async () => {
      await result.current.speakAISegments(aiSegments as any);
    });
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(3);
  });

  it('evicts the oldest cached segment once the cache exceeds the LRU bound', async () => {
    (VoiceDirector.validateAISegments as any).mockImplementation((segs: any) => segs);
    (VoiceDirector.processAISegments as any).mockImplementation((segs: any) =>
      segs.map((s: any) => ({ character: 'DM', text: s.text, voiceId: 'narrator' })),
    );
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: { text: string }) => ({
      ...segment,
      audioUrl: `http://test.com/${segment.text}.mp3`,
    }));
    mockPlayAudioSegment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    for (let i = 0; i < SEGMENT_AUDIO_CACHE_MAX + 1; i++) {
      defaultProps.state.isProcessing = false;
      await act(async () => {
        await result.current.speakAISegments([{ type: 'dm', text: `cap-${i}` }] as any);
      });
    }

    expect(getVoiceSegmentAudioCacheSize()).toBe(SEGMENT_AUDIO_CACHE_MAX);

    const generateCallsAfterFill = (VoiceDirector.generateAudio as any).mock.calls.length;
    defaultProps.state.isProcessing = false;
    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'cap-0' }] as any);
    });
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(generateCallsAfterFill + 1);
  });

  it('passes the abort signal into generateAudio so unmount can cancel in-flight fetches', async () => {
    const aiSegments = [{ type: 'dm', text: 'hold' }];
    const voiceSegments = [{ character: 'DM', text: 'hold', voiceId: 'narrator' }];
    let seenSignal: AbortSignal | undefined;

    (VoiceDirector.validateAISegments as any).mockReturnValue(aiSegments);
    (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
    (VoiceDirector.generateAudio as any).mockImplementation(
      async (segment: { text: string }, signal?: AbortSignal) => {
        seenSignal = signal;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve({ ...segment, audioUrl: 'http://test.com/hold.mp3' }),
            80,
          );
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      },
    );

    const { result, unmount } = renderHook(() => useVoiceProcessing(defaultProps));

    act(() => {
      void result.current.speakAISegments(aiSegments as any);
    });

    await vi.waitFor(() => {
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    });

    unmount();
    expect(seenSignal?.aborted).toBe(true);
  });

  it('does not return cached audio when a different text collides on the hash', async () => {
    // Java String.hashCode / (h<<5)-h collisions: "Aa" and "BB".
    const first = 'Aa';
    const colliding = 'BB';
    expect(first).not.toBe(colliding);
    expect(hashSegmentText(first)).toBe(hashSegmentText(colliding));

    (VoiceDirector.validateAISegments as any).mockImplementation((segs: any) => segs);
    (VoiceDirector.processAISegments as any).mockImplementation((segs: any) =>
      segs.map((s: any) => ({ character: 'DM', text: s.text, voiceId: 'narrator' })),
    );
    (VoiceDirector.generateAudio as any).mockImplementation(async (segment: { text: string }) => ({
      ...segment,
      audioUrl: `http://test.com/${segment.text}.mp3`,
    }));
    mockPlayAudioSegment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoiceProcessing(defaultProps));

    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: first }] as any);
    });
    expect(mockPlayAudioSegment).toHaveBeenCalledWith(
      expect.objectContaining({ text: first, audioUrl: 'http://test.com/Aa.mp3' }),
      0,
    );

    defaultProps.state.isProcessing = false;
    mockPlayAudioSegment.mockClear();
    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: colliding }] as any);
    });

    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(2);
    expect(mockPlayAudioSegment).toHaveBeenCalledWith(
      expect.objectContaining({ text: colliding, audioUrl: 'http://test.com/BB.mp3' }),
      0,
    );
    expect(mockPlayAudioSegment).not.toHaveBeenCalledWith(
      expect.objectContaining({ audioUrl: 'http://test.com/Aa.mp3' }),
      expect.anything(),
    );
  });
});
