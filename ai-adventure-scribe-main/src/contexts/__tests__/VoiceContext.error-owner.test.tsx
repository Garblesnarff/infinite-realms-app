import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { useVoiceContext, VoiceProvider } from '@/contexts/VoiceContext';

// The progressive voice hook is the only stub: the test controls its error and playing state.
const hookState: {
  error: string | undefined;
  isProcessing: boolean;
  isPlaying: boolean;
  isPaused: boolean;
} = { error: undefined, isProcessing: false, isPlaying: false, isPaused: false };
const speakAISegments = vi.fn(async () => undefined);
const speakPlainText = vi.fn(async () => undefined);

vi.mock('@/hooks/use-progressive-voice', () => ({
  useProgressiveVoice: () => ({
    ...hookState,
    volume: 1,
    isMuted: false,
    isVoiceEnabled: true,
    speakAISegments,
    speakPlainText,
    pausePlayback: vi.fn(),
    resumePlayback: vi.fn(),
    stopPlayback: vi.fn(),
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
    initializeAudioContext: vi.fn(),
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <VoiceProvider>{children}</VoiceProvider>
);

describe('VoiceContext playback error ownership', () => {
  beforeEach(() => {
    hookState.error = undefined;
    hookState.isProcessing = false;
    hookState.isPlaying = false;
    hookState.isPaused = false;
    speakPlainText.mockClear();
  });

  it('shows a failure on the message that failed, and not on the next message', () => {
    const { result, rerender } = renderHook(() => useVoiceContext(), { wrapper });

    hookState.isProcessing = true;
    act(() => result.current.playMessage('msg-a', 'First message'));
    rerender();
    hookState.isProcessing = false;
    hookState.error = 'Audio generation failed';
    rerender();
    expect(result.current.playbackError).toBe('Audio generation failed');

    // The next message's request returns early in the hook, so the old error is still set.
    hookState.isProcessing = true;
    act(() => result.current.playMessage('msg-b', 'Second message'));
    rerender();
    expect(result.current.currentPlayingId).toBe('msg-b');
    expect(result.current.playbackError).toBeNull();
  });

  it('keeps a failed message as the current one so Retry stays on it', () => {
    const { result, rerender } = renderHook(() => useVoiceContext(), { wrapper });

    hookState.isProcessing = true;
    act(() => result.current.playMessage('msg-a', 'First message'));
    rerender();
    hookState.isProcessing = false;
    hookState.error = 'Audio generation failed';
    rerender();

    expect(result.current.currentPlayingId).toBe('msg-a');
    expect(result.current.playbackError).toBe('Audio generation failed');
  });
});
