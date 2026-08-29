/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const mockToast = vi.hoisted(() => vi.fn());

const mockVoiceDirector = vi.hoisted(() => ({
  validateAISegments: vi.fn(),
  processAISegments: vi.fn(),
  generateAudio: vi.fn(),
  processPlainText: vi.fn(),
  getCharacterVoiceMappings: vi.fn(),
  clearCharacterVoiceMappings: vi.fn(),
  getAvailableVoiceCategories: vi.fn(),
  clearAudioCache: vi.fn(),
  getAudioCacheStats: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: mockLogger,
  logger: mockLogger,
}));

vi.mock('../use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/services/voice-director', () => ({
  VoiceDirector: mockVoiceDirector,
}));

import { useProgressiveVoice } from '../use-progressive-voice';

class TestAudio {
  src = '';
  volume = 1;
  currentTime = 0;
  private listeners: Record<string, Set<EventListener>> = {};

  addEventListener(event: string, callback: EventListener): void {
    this.listeners[event] ??= new Set();
    this.listeners[event].add(callback);
  }

  removeEventListener(event: string, callback: EventListener): void {
    this.listeners[event]?.delete(callback);
  }

  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn(() => this.trigger('loadeddata'));

  trigger(event: string): void {
    const eventObject = new Event(event);
    this.listeners[event]?.forEach((callback) => callback(eventObject));
  }
}

describe('useProgressiveVoice lifecycle', () => {
  let audioInstances: TestAudio[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    audioInstances = [];

    vi.stubGlobal(
      'Audio',
      vi.fn(() => {
        const audio = new TestAudio();
        audioInstances.push(audio);
        return audio;
      }),
    );
    vi.stubGlobal('URL', { revokeObjectURL: vi.fn() });

    mockVoiceDirector.validateAISegments.mockImplementation((segments: any[]) => segments);
    mockVoiceDirector.processAISegments.mockImplementation((segments: any[]) =>
      segments.map((segment, index) => ({
        id: `segment-${index}`,
        type: segment.type,
        text: segment.text,
        character: 'DM',
        voiceId: 'voice-id',
        voiceName: 'Test Voice',
        voiceSettings: { stability: 0.5, similarity_boost: 0.5 },
        isGenerating: false,
        isPlaying: false,
      })),
    );
    mockVoiceDirector.generateAudio.mockImplementation(async (segment: any) => ({
      ...segment,
      audioUrl: 'blob:test-audio',
    }));
  });

  it('plays a started segment without immediately stopping it during state updates', async () => {
    const { result, unmount } = renderHook(() => useProgressiveVoice());

    let speakPromise: Promise<void>;
    act(() => {
      speakPromise = result.current.speakAISegments([{ type: 'dm', text: 'The ward shatters.' }]);
    });

    await waitFor(() => expect(audioInstances[0]?.play).toHaveBeenCalledTimes(1));

    expect(mockLogger.info).not.toHaveBeenCalledWith('🛑 Stopping progressive voice playback');

    const audio = audioInstances[0];
    if (!audio) {
      throw new Error('Expected the test audio element to be created');
    }

    act(() => {
      audio.trigger('ended');
    });
    await act(async () => {
      await speakPromise;
    });

    expect(result.current.isPlaying).toBe(false);
    unmount();
  });
});
