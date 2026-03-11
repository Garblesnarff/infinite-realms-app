/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useVoiceAudioControl } from '../use-voice-audio-control';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Audio
class MockAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  private listeners: Record<string, Set<Function>> = {};

  addEventListener(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = new Set();
    this.listeners[event].add(callback);
  }

  removeEventListener(event: string, callback: Function) {
    this.listeners[event]?.delete(callback);
  }

  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();

  // Helper to trigger events in tests
  trigger(event: string, data?: any) {
    this.listeners[event]?.forEach((cb) => cb(data));
  }
}

describe('useVoiceAudioControl', () => {
  let mockAudioInstances: MockAudio[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockAudioInstances = [];

    // Setup global Audio mock
    vi.stubGlobal(
      'Audio',
      vi.fn(() => {
        const instance = new MockAudio();
        mockAudioInstances.push(instance);
        return instance;
      }),
    );

    // Setup global URL mock
    vi.stubGlobal('URL', {
      revokeObjectURL: vi.fn(),
    });
  });

  it('should initialize with default volume and muted state', () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    expect(result.current.volume).toBe(1);
    expect(result.current.isMuted).toBe(false);
  });

  it('should initializeAudioContext correctly', () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    let audio: any;

    act(() => {
      audio = result.current.initializeAudioContext();
    });

    expect(Audio).toHaveBeenCalled();
    expect(audio).toBeInstanceOf(MockAudio);
    expect(audio.volume).toBe(1);

    // Should not create a second one if called again
    act(() => {
      const secondAudio = result.current.initializeAudioContext();
      expect(secondAudio).toBe(audio);
      expect(Audio).toHaveBeenCalledTimes(1);
    });
  });

  it('should respect muted state in initializeAudioContext', () => {
    window.localStorage.setItem('progressive-voice-muted', '1');
    const { result } = renderHook(() => useVoiceAudioControl());

    let audio: any;
    act(() => {
      audio = result.current.initializeAudioContext();
    });

    expect(audio.volume).toBe(0);
  });

  it('should playAudioSegment successfully', async () => {
    const onSegmentStart = vi.fn();
    const onSegmentEnd = vi.fn();
    const { result } = renderHook(() =>
      useVoiceAudioControl({ onSegmentStart, onSegmentEnd }),
    );

    const segment = {
      character: 'Test Character',
      text: 'Test Text',
      audioUrl: 'blob:test-url',
    } as any;

    let playPromise: Promise<void>;
    act(() => {
      playPromise = result.current.playAudioSegment(segment, 0);
    });

    const audio = mockAudioInstances[0];
    expect(audio.src).toBe(segment.audioUrl);
    expect(audio.load).toHaveBeenCalled();
    expect(onSegmentStart).toHaveBeenCalledWith(0);

    // Trigger loadeddata
    act(() => {
      audio.trigger('loadeddata');
    });

    expect(audio.play).toHaveBeenCalled();

    // Trigger ended
    act(() => {
      audio.trigger('ended');
    });

    await playPromise!;
    expect(onSegmentEnd).toHaveBeenCalledWith(0, segment.audioUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(segment.audioUrl);
  });

  it('should handle missing audioUrl in playAudioSegment', async () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    const segment = { audioUrl: '' } as any;

    await result.current.playAudioSegment(segment, 0);
    expect(Audio).not.toHaveBeenCalled();
  });

  it('should handle audio error in playAudioSegment', async () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Error text',
      character: 'Error character',
    } as any;

    let playPromise: Promise<void>;
    act(() => {
      playPromise = result.current.playAudioSegment(segment, 0);
    });

    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('error', new Event('error'));
    });

    await playPromise!;
    // Should resolve even on error to allow sequence to continue if needed
  });

  it('should handle audio abort in playAudioSegment', async () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Abort text',
      character: 'Abort character',
    } as any;

    let playPromise: Promise<void>;
    act(() => {
      playPromise = result.current.playAudioSegment(segment, 0);
    });

    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('abort');
    });

    await playPromise!;
  });

  it('should pausePlayback correctly', async () => {
    const onPlaybackPause = vi.fn();
    const { result } = renderHook(() => useVoiceAudioControl({ onPlaybackPause }));

    // Start playing first to set currentAudio
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Pause text',
      character: 'Pause character',
    } as any;
    act(() => {
      result.current.playAudioSegment(segment, 0);
    });
    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('loadeddata');
    });

    act(() => {
      result.current.pausePlayback();
    });

    expect(audio.pause).toHaveBeenCalled();
    expect(onPlaybackPause).toHaveBeenCalled();
  });

  it('should resumePlayback correctly', async () => {
    const onPlaybackResume = vi.fn();
    const { result } = renderHook(() => useVoiceAudioControl({ onPlaybackResume }));

    // Start playing first to set currentAudio
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Resume text',
      character: 'Resume character',
    } as any;
    act(() => {
      result.current.playAudioSegment(segment, 0);
    });
    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('loadeddata');
    });

    let resumeResult: boolean;
    await act(async () => {
      resumeResult = await result.current.resumePlayback();
    });

    expect(audio.play).toHaveBeenCalledTimes(2); // Once for initial play, once for resume
    expect(onPlaybackResume).toHaveBeenCalled();
    expect(resumeResult!).toBe(true);
  });

  it('should return false when resumePlayback is called with no audio', async () => {
    const { result } = renderHook(() => useVoiceAudioControl());
    let resumeResult: boolean;
    await act(async () => {
      resumeResult = await result.current.resumePlayback();
    });
    expect(resumeResult!).toBe(false);
  });

  it('should stopPlayback correctly', () => {
    const onPlaybackStop = vi.fn();
    const { result } = renderHook(() => useVoiceAudioControl({ onPlaybackStop }));

    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Stop text',
      character: 'Stop character',
    } as any;
    act(() => {
      result.current.playAudioSegment(segment, 0);
    });
    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('loadeddata');
    });

    act(() => {
      result.current.stopPlayback([segment]);
    });

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(segment.audioUrl);
    expect(onPlaybackStop).toHaveBeenCalled();
  });

  it('should handleSetVolume correctly', () => {
    const { result } = renderHook(() => useVoiceAudioControl());

    // Mock current audio
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Volume text',
      character: 'Volume character',
    } as any;
    act(() => {
      result.current.playAudioSegment(segment, 0);
    });
    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('loadeddata');
    });

    act(() => {
      result.current.handleSetVolume(0.5);
    });

    expect(result.current.volume).toBe(0.5);
    expect(audio.volume).toBe(0.5);
    expect(window.localStorage.getItem('progressive-voice-volume')).toBe('0.5');
  });

  it('should clamp volume between 0 and 1', () => {
    const { result } = renderHook(() => useVoiceAudioControl());

    act(() => {
      result.current.handleSetVolume(1.5);
    });
    expect(result.current.volume).toBe(1);

    act(() => {
      result.current.handleSetVolume(-0.5);
    });
    expect(result.current.volume).toBe(0);
  });

  it('should toggleMute correctly', () => {
    const { result } = renderHook(() => useVoiceAudioControl());

    // Mock current audio
    const segment = {
      audioUrl: 'blob:test-url',
      text: 'Mute text',
      character: 'Mute character',
    } as any;
    act(() => {
      result.current.playAudioSegment(segment, 0);
    });
    const audio = mockAudioInstances[0];
    act(() => {
      audio.trigger('loadeddata');
    });

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(true);
    expect(audio.volume).toBe(0);
    expect(window.localStorage.getItem('progressive-voice-muted')).toBe('1');

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(false);
    expect(audio.volume).toBe(1);
    expect(window.localStorage.getItem('progressive-voice-muted')).toBe('0');
  });
});
