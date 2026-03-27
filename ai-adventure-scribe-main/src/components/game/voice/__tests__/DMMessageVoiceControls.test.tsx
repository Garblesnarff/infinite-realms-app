/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  Button: ({
    children,
    onClick,
    ariaLabel,
    title,
    className,
    variant: _variant,
    size: _size,
    ...props
  }: any) => (
    <button
      onClick={onClick}
      aria-label={ariaLabel || props['aria-label']}
      title={title}
      className={className}
      {...props}
    >
      {children}
    </button>
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

  it('renders nothing if speechSynthesis is not available', () => {
    // We need to delete it from window to make 'speechSynthesis' in window false
    const originalSpeechSynthesis = window.speechSynthesis;
    // @ts-ignore - explicitly testing unavailability
    delete (window as any).speechSynthesis;
    try {
      const { container } = render(<DMMessageVoiceControls {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    } finally {
      Object.defineProperty(window, 'speechSynthesis', {
        value: originalSpeechSynthesis,
        configurable: true,
        writable: true,
      });
    }
  });

  it('renders play button when not playing', () => {
    render(<DMMessageVoiceControls {...defaultProps} />);

    const playButton = screen.getByRole('button', { name: /play this message/i });
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

    const pauseButton = screen.getByRole('button', { name: /pause reading/i });
    expect(pauseButton).toBeInTheDocument();
    expect(screen.getByTestId('pause-icon')).toBeInTheDocument();
    // Use a more specific matcher for "Playing" text to avoid matches in sr-only
    expect(screen.getByText(/^Playing$/)).toBeInTheDocument();
  });

  it('calls playMessage when play button is clicked', () => {
    render(<DMMessageVoiceControls {...defaultProps} />);

    const playButton = screen.getByRole('button', { name: /play this message/i });
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

    const pauseButton = screen.getByRole('button', { name: /pause reading/i });
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

    const playButton = screen.getByRole('button', { name: /play/i });
    const wrapper = playButton.parentElement;
    if (!wrapper) {
      throw new Error('Wrapper not found');
    }

    fireEvent.click(wrapper);
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('is always visible on touch devices', () => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });

    const { container } = render(<DMMessageVoiceControls {...defaultProps} />);
    const wrapper = container.firstChild as HTMLElement;

    expect(wrapper).toHaveClass('opacity-100');
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
});
