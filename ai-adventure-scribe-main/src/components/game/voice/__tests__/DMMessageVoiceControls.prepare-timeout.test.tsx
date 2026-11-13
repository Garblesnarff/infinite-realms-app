import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DMMessageVoiceControls } from '../DMMessageVoiceControls';

import { useVoiceContext } from '@/contexts/VoiceContext';

vi.mock('@/contexts/VoiceContext', () => ({
  useVoiceContext: vi.fn(),
}));

const TIMEOUT_MESSAGE = 'Voice took too long to prepare';

describe('DMMessageVoiceControls prepare timeout (#1348)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the timeout message with a Try again control when the prepare was cancelled', () => {
    (useVoiceContext as any).mockReturnValue({
      currentPlayingId: 'msg-old',
      isPlaying: false,
      isProcessing: false,
      playbackError: TIMEOUT_MESSAGE,
      retryMessage: vi.fn(),
      stopMessage: vi.fn(),
      playMessage: vi.fn(),
      pauseMessage: vi.fn(),
      volume: 1,
      isMuted: false,
      setVolume: vi.fn(),
      toggleMute: vi.fn(),
    });

    render(<DMMessageVoiceControls messageId="msg-old" messageText="Previously, on the road." />);

    expect(screen.getByRole('alert')).toHaveTextContent('The voice took too long to prepare.');
    expect(screen.getByRole('button', { name: 'The voice failed. Try again' })).toBeInTheDocument();
  });
});
