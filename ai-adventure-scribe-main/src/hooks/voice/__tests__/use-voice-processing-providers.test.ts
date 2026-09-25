/* eslint-disable @typescript-eslint/no-explicit-any */
import { type RenderHookResult, act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearVoiceSegmentAudioCache, useVoiceProcessing } from '../use-voice-processing';

import { speakSegment } from '@/services/voice/speech-synthesis-voice';
import { reloadVoiceModeStatus, setVoiceMode } from '@/services/voice/voice-mode-store';
import { VoiceDirector } from '@/services/voice-director';

vi.mock('@/services/voice-director', () => ({
  VoiceDirector: {
    generateAudio: vi.fn(),
    validateAISegments: vi.fn(),
    processAISegments: vi.fn(),
  },
}));

vi.mock('@/services/voice/speech-synthesis-voice', () => ({
  speakSegment: vi.fn(async () => undefined),
  hasSpeechSynthesis: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const playAudioSegment = vi.fn(async () => undefined);

function renderProcessing(): RenderHookResult<ReturnType<typeof useVoiceProcessing>, unknown> {
  return renderHook(() =>
    useVoiceProcessing({
      state: {
        isVoiceEnabled: true,
        isProcessing: false,
        isPlaying: false,
        isPaused: false,
        isStalled: false,
        segments: [],
        currentSegmentIndex: -1,
      } as any,
      setState: vi.fn(),
      toast: vi.fn(),
      playAudioSegment,
      initializeAudioContext: vi.fn(),
      stopPlayback: vi.fn(),
      baseResumePlayback: vi.fn(),
      currentAudio: { current: null } as any,
    }),
  );
}

async function speak(voiceSegments: any[]): Promise<void> {
  (VoiceDirector.validateAISegments as any).mockReturnValue(voiceSegments);
  (VoiceDirector.processAISegments as any).mockReturnValue(voiceSegments);
  const { result } = renderProcessing();
  await act(async () => {
    await result.current.speakAISegments(voiceSegments);
  });
}

describe('useVoiceProcessing with voice providers', () => {
  const segment = { type: 'dm', character: 'DM', text: 'The gate creaks.', voiceId: 'v1' };

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    reloadVoiceModeStatus();
    clearVoiceSegmentAudioCache();
  });

  it('speaks speechSynthesis segments instead of playing an audio element', async () => {
    (VoiceDirector.generateAudio as any).mockImplementation(async (s: any) => ({
      ...s,
      provider: 'speech-synthesis',
    }));

    await speak([segment]);

    expect(speakSegment).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'The gate creaks.' }),
      expect.any(AbortSignal),
    );
    expect(playAudioSegment).not.toHaveBeenCalled();
  });

  it('does not serve premium audio from the segment cache once Standard is active', async () => {
    (VoiceDirector.generateAudio as any).mockImplementation(async (s: any) => ({
      ...s,
      audioUrl: 'blob:premium',
      provider: 'elevenlabs',
    }));
    await speak([segment]);
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(1);

    // Replay under premium: cache hit.
    await speak([segment]);
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(1);

    // Switch to Standard: same text/voice must be generated again.
    setVoiceMode('standard');
    (VoiceDirector.generateAudio as any).mockImplementation(async (s: any) => ({
      ...s,
      audioUrl: 'blob:kokoro',
      provider: 'kokoro',
    }));
    await speak([segment]);
    expect(VoiceDirector.generateAudio).toHaveBeenCalledTimes(2);
    expect(playAudioSegment).toHaveBeenLastCalledWith(
      expect.objectContaining({ audioUrl: 'blob:kokoro' }),
      0,
    );
  });
});
