/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { DMMessageVoiceControls } from '../DMMessageVoiceControls';

import { useVoiceContext } from '@/contexts/VoiceContext';
import { extractNarrativeContent } from '@/utils/parseMessageOptions';

// Mock dependencies
vi.mock('@/contexts/VoiceContext', () => ({
  useVoiceContext: vi.fn(),
}));

vi.mock('@/utils/parseMessageOptions', () => ({
  extractNarrativeContent: vi.fn((text) => text),
}));

// Mock Lucide icons to avoid rendering complexity
vi.mock('lucide-react', () => ({
  Play: () => <div data-testid="play-icon" />,
  Pause: () => <div data-testid="pause-icon" />,
  Volume2: () => <div data-testid="volume-icon" />,
  VolumeX: () => <div data-testid="mute-icon" />,
  Loader2: () => <div data-testid="loader-icon" />,
  RotateCw: () => <div data-testid="retry-icon" />,
}));

// Mock UI components
vi.mock('@/components/ui/slider', () => ({
  Slider: (props: any) => (
    <input
      type="range"
      aria-label={props['aria-label']}
      value={props.value[0]}
      onChange={(e) => props.onValueChange([parseFloat(e.target.value)])}
    />
  ),
}));

// Mock Button to just render children and handle clicks
vi.mock('@/components/ui/button', () => ({
  Button: React.forwardRef<HTMLButtonElement, any>(
    (
      { children, onClick, ariaLabel, title, className, variant: _variant, size: _size, ...props },
      ref,
    ) => (
      <button
        ref={ref}
        onClick={onClick}
        aria-label={ariaLabel || props['aria-label']}
        title={title}
        className={className}
        {...props}
      >
        {children}
      </button>
    ),
  ),
}));

describe('DMMessageVoiceControls', () => {
  const mockVoiceContext = {
    currentPlayingId: null,
    isPlaying: false,
    playMessage: vi.fn(),
    pauseMessage: vi.fn(),
    volume: 1,
    isMuted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
  };

  const defaultProps = {
    messageId: 'msg-123',
    messageText: 'Hello world',
    narrationSegments: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useVoiceContext as any).mockReturnValue(mockVoiceContext);

    // Default to having speechSynthesis available
    if (!('speechSynthesis' in window)) {
      Object.defineProperty(window, 'speechSynthesis', {
        value: {},
        configurable: true,
        writable: true,
      });
    }

    // Default to non-touch device
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 0,
      configurable: true,
      writable: true,
    });
  });

  it('still renders the Listen control when speechSynthesis is missing (ElevenLabs audio)', () => {
    // Clips play through an audio element, so the browser's speech API is not the gate (#1236 C).
    const originalSpeechSynthesis = window.speechSynthesis;
    // @ts-ignore - explicitly testing unavailability
    delete (window as any).speechSynthesis;
    try {
      render(<DMMessageVoiceControls {...defaultProps} />);
      expect(screen.getByRole('button', { name: /listen to this message/i })).toBeInTheDocument();
      expect(screen.getByText('Listen')).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'speechSynthesis', {
        value: originalSpeechSynthesis,
        configurable: true,
        writable: true,
      });
    }
  });

  it('renders nothing when the browser has no audio element', () => {
    const originalAudio = window.Audio;
    // @ts-ignore - explicitly testing unavailability
    delete (window as any).Audio;
    try {
      const { container } = render(<DMMessageVoiceControls {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    } finally {
      window.Audio = originalAudio;
    }
  });

  it('shows Preparing voice while this message is being generated, with no play button', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: false,
      isProcessing: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.getByText('Preparing voice…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /listen to this message/i })).toBeNull();
  });

  it('marks the preparing control busy with the board aria label', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: false,
      isProcessing: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    const preparing = screen.getByRole('button', { name: 'Preparing the voice' });
    expect(preparing).toHaveAttribute('aria-busy', 'true');
    expect(preparing).toBeDisabled();
  });

  it('lets the player cancel a clip that is still being prepared', () => {
    const stopMessage = vi.fn();
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: false,
      isProcessing: true,
      stopMessage,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Cancel preparing voice for this message' }),
    );
    expect(stopMessage).toHaveBeenCalledTimes(1);
  });

  it('shows the failure and a Try again that plays the message again', () => {
    const retryMessage = vi.fn();
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: false,
      isProcessing: false,
      playbackError: 'Audio generation failed',
      retryMessage,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.getByText('The voice could not load.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The voice could not load.');
    fireEvent.click(screen.getByRole('button', { name: 'The voice failed. Try again' }));
    expect(retryMessage).toHaveBeenCalledTimes(1);
  });

  it('shows the limit state, with no retry, when the error names a limit', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: false,
      isProcessing: false,
      playbackError: 'Voice limit reached for this session',
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Voice limit reached' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voice limit reached' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText('The text still works.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(
      screen.queryByRole('button', { name: 'The voice failed. Try again' }),
    ).not.toBeInTheDocument();
  });

  it('does not show an error for a different message', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-other',
      isPlaying: false,
      playbackError: 'Audio generation failed',
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.queryByText('The voice could not load.')).toBeNull();
    expect(screen.getByRole('button', { name: /listen to this message/i })).toBeInTheDocument();
  });

  it('renders play button when not playing', () => {
    render(<DMMessageVoiceControls {...defaultProps} />);

    const playButton = screen.getByRole('button', { name: /listen to this message/i });
    expect(playButton).toBeInTheDocument();
    expect(screen.getByTestId('play-icon')).toBeInTheDocument();
  });

  it('renders pause button when currently playing', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    const pauseButton = screen.getByRole('button', { name: /pause the voice/i });
    expect(pauseButton).toBeInTheDocument();
    expect(screen.getByTestId('pause-icon')).toBeInTheDocument();
    // Use a more specific matcher for "Playing" text to avoid matches in sr-only
    expect(screen.getByText(/^Playing$/)).toBeInTheDocument();
    // Board equalizer: three bars beside the Playing label
    const playing = screen.getByLabelText('Currently playing message');
    expect(playing.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('calls playMessage when play button is clicked', () => {
    render(<DMMessageVoiceControls {...defaultProps} />);

    const playButton = screen.getByRole('button', { name: /listen to this message/i });
    fireEvent.click(playButton);

    expect(extractNarrativeContent).toHaveBeenCalledWith('Hello world');
    expect(mockVoiceContext.playMessage).toHaveBeenCalledWith('msg-123', 'Hello world', []);
  });

  it('calls pauseMessage when pause button is clicked', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    const pauseButton = screen.getByRole('button', { name: /pause the voice/i });
    fireEvent.click(pauseButton);

    expect(mockVoiceContext.pauseMessage).toHaveBeenCalled();
  });

  it('shows volume controls when playing', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument();
  });

  it('calls toggleMute when volume icon is clicked', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    const muteButton = screen.getByRole('button', { name: /mute/i });
    fireEvent.click(muteButton);

    expect(mockVoiceContext.toggleMute).toHaveBeenCalled();
  });

  it('shows mute icon when muted', () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
      isMuted: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    expect(screen.getByRole('button', { name: /unmute/i })).toBeInTheDocument();
    expect(screen.getByTestId('mute-icon')).toBeInTheDocument();
  });

  it('shows volume slider on hover and handles volume change', async () => {
    (useVoiceContext as any).mockReturnValue({
      ...mockVoiceContext,
      currentPlayingId: 'msg-123',
      isPlaying: true,
    });

    render(<DMMessageVoiceControls {...defaultProps} />);

    // Volume button is always shown when playing
    const muteButton = screen.getByRole('button', { name: /mute/i });
    const volumeControls = muteButton.parentElement;
    if (!volumeControls) {
      throw new Error('Volume controls not found');
    }

    fireEvent.mouseEnter(volumeControls);

    const slider = screen.getByLabelText('Volume');
    expect(slider).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(mockVoiceContext.setVolume).toHaveBeenCalledWith(0.5);

    // Test hiding it again
    fireEvent.mouseLeave(volumeControls);
    expect(screen.queryByLabelText('Volume')).not.toBeInTheDocument();
  });

  it('stops propagation when clicked', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick} data-testid="parent">
        <DMMessageVoiceControls {...defaultProps} />
      </div>,
    );

    const playButton = screen.getByRole('button', { name: /listen/i });
    const wrapper = playButton.parentElement;
    if (!wrapper) {
      throw new Error('Wrapper not found');
    }

    fireEvent.click(wrapper);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('is visible at rest on every device, not only on hover', () => {
    const { container } = render(<DMMessageVoiceControls {...defaultProps} />);
    const wrapper = container.firstChild as HTMLElement;

    expect(wrapper.className).not.toMatch(/opacity-0|group-hover/);
  });

  it('includes screen reader only text for narration segments', () => {
    render(
      <DMMessageVoiceControls
        {...defaultProps}
        narrationSegments={[{ type: 'character', text: 'Hi', character: 'Elf' } as any]}
      />,
    );

    expect(screen.getByText(/This message has 1 voice segments/i)).toBeInTheDocument();
  });

  describe('debug voice-segment note (#2256)', () => {
    const withSegments = (
      <DMMessageVoiceControls
        {...defaultProps}
        narrationSegments={[{ type: 'character', text: 'Hi', character: 'Elf' } as any]}
      />
    );

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('does not render the note when DEV is false, and keeps the play control', () => {
      vi.stubEnv('DEV', false);
      const { container } = render(withSegments);

      expect(container.textContent).not.toMatch(/voice segments/i);
      expect(screen.getByRole('button', { name: /listen/i })).toBeInTheDocument();
    });

    it('renders the note when DEV is true', () => {
      vi.stubEnv('DEV', true);
      render(withSegments);

      expect(screen.getByText(/This message has 1 voice segments/i)).toBeInTheDocument();
    });
  });
});
