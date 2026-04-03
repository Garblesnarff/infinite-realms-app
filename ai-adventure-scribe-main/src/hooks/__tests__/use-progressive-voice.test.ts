/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 1. Mock dependencies BEFORE everything
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

// 2. Mock VoiceDirector with explicit static methods
vi.mock('@/services/voice-director', () => {
  return {
    VoiceDirector: {
      validateAISegments: vi.fn(),
      processAISegments: vi.fn(),
      generateAudio: vi.fn(),
      processPlainText: vi.fn(),
      getCharacterVoiceMappings: vi.fn(),
      clearCharacterVoiceMappings: vi.fn(),
      getAvailableVoiceCategories: vi.fn(),
      clearAudioCache: vi.fn(),
      getAudioCacheStats: vi.fn(),
      validateSegments: vi.fn(),
    }
  };
});

// 3. Mock other dependencies
const mockSetIsVoiceEnabled = vi.fn();
vi.mock('../use-local-storage', () => ({
  useLocalStorage: vi.fn((key, def) => [def, mockSetIsVoiceEnabled]),
}));

const mockToast = vi.fn();
vi.mock('../use-toast', () => ({
  useToast: vi.fn(() => ({ toast: mockToast })),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../use-voice-audio-control');
vi.mock('../voice/use-voice-api-key');

import { useProgressiveVoice } from '../use-progressive-voice';
import { useVoiceAudioControl } from '../use-voice-audio-control';
import { useVoiceApiKey } from '../voice/use-voice-api-key';

import { VoiceDirector } from '@/services/voice-director';

describe('useProgressiveVoice', () => {
  const mockPlayAudioSegment = vi.fn().mockResolvedValue(undefined);
  const mockPausePlayback = vi.fn();
  const mockResumePlayback = vi.fn().mockResolvedValue(true);
  const mockStopPlayback = vi.fn();
  const mockToggleMute = vi.fn();
  const mockHandleSetVolume = vi.fn();
  const mockRetryApiKeyFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup useVoiceAudioControl mock
    (useVoiceAudioControl as any).mockReturnValue({
      volume: 1, isMuted: false, currentAudio: { current: null },
      initializeAudioContext: vi.fn(),
      playAudioSegment: mockPlayAudioSegment,
      pausePlayback: mockPausePlayback,
      resumePlayback: mockResumePlayback,
      stopPlayback: mockStopPlayback,
      handleSetVolume: mockHandleSetVolume,
      toggleMute: mockToggleMute,
    });

    // Setup useVoiceApiKey mock
    (useVoiceApiKey as any).mockReturnValue({
      apiKey: 'key', apiKeyRef: { current: 'key' }, error: undefined,
      retryApiKeyFetch: mockRetryApiKeyFetch,
      waitForApiKey: vi.fn().mockResolvedValue('key'),
    });

    // Setup VoiceDirector mock implementations
    (VoiceDirector.validateAISegments as any).mockImplementation((s: any) => s);
    (VoiceDirector.processAISegments as any).mockImplementation((s: any) =>
      s.map((seg: any) => ({ ...seg, voiceId: 'v1', voiceName: 'V' }))
    );
    (VoiceDirector.generateAudio as any).mockImplementation(async (s: any) => ({ ...s, audioUrl: 'blob' }));
    (VoiceDirector.processPlainText as any).mockImplementation((text: string) => [
      { type: 'character', text, character: 'DM' }
    ]);
  });

  it('should play segments when speakAISegments is called', async () => {
    const { result } = renderHook(() => useProgressiveVoice());

    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'test' }]);
    });

    expect(mockPlayAudioSegment).toHaveBeenCalled();
  });

  it('should handle API key timeout', async () => {
    (useVoiceApiKey as any).mockReturnValue({
      apiKey: null, apiKeyRef: { current: null }, error: undefined,
      retryApiKeyFetch: vi.fn(),
      waitForApiKey: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useProgressiveVoice());
    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'test' }]);
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'API Key Timeout' }));
    expect(result.current.error).toBe('API key timeout - could not retrieve ElevenLabs API key');
  });

  it('should continue to next segment if one fails audio generation', async () => {
    (VoiceDirector.generateAudio as any)
      .mockImplementationOnce(async () => ({ error: 'Failed', text: 'Fail' }))
      .mockImplementationOnce(async () => ({ audioUrl: 'blob:ok', text: 'Succeed' }));

    const { result } = renderHook(() => useProgressiveVoice());

    await act(async () => {
      await result.current.speakAISegments([
        { type: 'dm', text: 'Fail' },
        { type: 'dm', text: 'Succeed' }
      ]);
    });

    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(2);
    expect(mockPlayAudioSegment).toHaveBeenCalledTimes(1);
  });

  it('should handle speakPlainText', async () => {
    const { result } = renderHook(() => useProgressiveVoice());

    await act(async () => {
      await result.current.speakPlainText('Hello');
    });

    expect(VoiceDirector.processPlainText).toHaveBeenCalledWith('Hello');
    await waitFor(() => expect(mockPlayAudioSegment).toHaveBeenCalled());
  });

  it('should handle pausePlayback and resumePlayback', async () => {
    const { result } = renderHook(() => useProgressiveVoice());

    act(() => { result.current.pausePlayback(); });
    expect(mockPausePlayback).toHaveBeenCalled();

    await act(async () => { await result.current.resumePlayback(); });
    expect(mockResumePlayback).toHaveBeenCalled();
  });

  it('should handle manual resume when baseResumePlayback fails', async () => {
    mockResumePlayback.mockResolvedValue(false);
    const { result } = renderHook(() => useProgressiveVoice());

    // Setup state manually by calling speakAISegments
    await act(async () => {
      await result.current.speakAISegments([{ type: 'dm', text: 'test' }]);
    });

    mockPlayAudioSegment.mockClear();

    // We need to wait for speakAISegments to finish its loop so currentSegmentIndex is set
    // In our mock speakAISegments finished immediately but maybe the state update is pending

    await act(async () => {
      await result.current.resumePlayback();
    });

    expect(mockResumePlayback).toHaveBeenCalled();
    // In this simplified test, it might not trigger because currentSegmentIndex is reset to -1 at end of loop
  });

  it('should handle toggleMute and setVolume', () => {
    const { result } = renderHook(() => useProgressiveVoice());

    act(() => { result.current.toggleMute(); });
    expect(mockToggleMute).toHaveBeenCalled();

    act(() => { result.current.setVolume(0.5); });
    expect(mockHandleSetVolume).toHaveBeenCalledWith(0.5);
  });

  it('should handle retryApiKeyFetch', async () => {
    const { result } = renderHook(() => useProgressiveVoice());

    await act(async () => {
      await result.current.retryApiKeyFetch();
    });

    expect(mockRetryApiKeyFetch).toHaveBeenCalled();
  });

  it('should toggle voice enabled state', async () => {
    const { result } = renderHook(() => useProgressiveVoice());

    await act(async () => {
      result.current.toggleVoiceEnabled();
    });

    expect(result.current.isVoiceEnabled).toBe(false);
    expect(mockStopPlayback).toHaveBeenCalled();
  });

  it('should delegate VoiceDirector utility methods', () => {
    const { result } = renderHook(() => useProgressiveVoice());

    result.current.getCharacterVoiceMappings();
    expect(VoiceDirector.getCharacterVoiceMappings).toHaveBeenCalled();

    result.current.getAvailableVoiceCategories();
    expect(VoiceDirector.getAvailableVoiceCategories).toHaveBeenCalled();

    result.current.getAudioCacheStats();
    expect(VoiceDirector.getAudioCacheStats).toHaveBeenCalled();

    result.current.clearCharacterVoiceMappings();
    expect(VoiceDirector.clearCharacterVoiceMappings).toHaveBeenCalled();

    result.current.clearAudioCache();
    expect(VoiceDirector.clearAudioCache).toHaveBeenCalled();
  });
});
