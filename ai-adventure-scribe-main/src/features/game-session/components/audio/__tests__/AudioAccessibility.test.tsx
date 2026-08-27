import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { VoiceButton } from '../VoiceButton';
import { VoicePlayerControls } from '../VoicePlayerControls';
import { VolumeButton } from '../VolumeButton';
import { VolumeSlider } from '../VolumeSlider';

import { TooltipProvider } from '@/components/ui/tooltip';

describe('Audio Components Accessibility and UX', () => {
  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  });

  describe('VolumeButton', () => {
    it('renders with type="button" and accurate aria attributes', () => {
      const onToggleMute = vi.fn();
      const { rerender } = render(
        <TooltipProvider>
          <VolumeButton isMuted={true} isSpeaking={false} onToggleMute={onToggleMute} />
        </TooltipProvider>,
      );

      const button = screen.getByRole('button', { name: /unmute voice/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(button);
      expect(onToggleMute).toHaveBeenCalledTimes(1);

      rerender(
        <TooltipProvider>
          <VolumeButton isMuted={false} isSpeaking={true} onToggleMute={onToggleMute} />
        </TooltipProvider>,
      );

      const updatedButton = screen.getByRole('button', { name: /mute voice/i });
      expect(updatedButton).toBeInTheDocument();
      expect(updatedButton).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('VoiceButton', () => {
    it('renders with type="button" and accurate aria attributes', () => {
      const onToggleMute = vi.fn();
      const { rerender } = render(
        <TooltipProvider>
          <VoiceButton isMuted={true} isSpeaking={false} onToggleMute={onToggleMute} />
        </TooltipProvider>,
      );

      const button = screen.getByRole('button', { name: /unmute/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(button);
      expect(onToggleMute).toHaveBeenCalledTimes(1);

      rerender(
        <TooltipProvider>
          <VoiceButton isMuted={false} isSpeaking={true} onToggleMute={onToggleMute} />
        </TooltipProvider>,
      );

      const updatedButton = screen.getByRole('button', { name: /mute/i });
      expect(updatedButton).toBeInTheDocument();
      expect(updatedButton).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('VolumeSlider', () => {
    it('provides getAriaValueText with screen-reader friendly value percentages', () => {
      const onVolumeChange = vi.fn();
      render(
        <TooltipProvider>
          <VolumeSlider volume={0.8} onVolumeChange={onVolumeChange} />
        </TooltipProvider>,
      );

      const sliderRoot = screen.getByLabelText(/adjust volume/i);
      const slider = within(sliderRoot).getByRole('slider');
      expect(slider).toHaveAttribute('aria-valuetext', '80%');
    });
  });

  describe('VoicePlayerControls', () => {
    it('provides descriptive aria-valuetext for playback volume slider', () => {
      render(
        <TooltipProvider>
          <VoicePlayerControls
            text="Hello traveler"
            isVoiceEnabled={true}
            isProcessing={false}
            isPlaying={false}
            stopPlayback={vi.fn()}
            isMuted={false}
            volume={0.85}
            toggleMute={vi.fn()}
            setVolume={vi.fn()}
            showSegments={false}
            setShowSegments={vi.fn()}
            segments={[]}
            initializeAudioContext={vi.fn()}
            hasUserInteracted={true}
            setHasUserInteracted={vi.fn()}
            speakAISegments={vi.fn()}
            speakPlainText={vi.fn()}
            clearCharacterVoiceMappings={vi.fn()}
          />
        </TooltipProvider>,
      );

      const sliderRoot = screen.getByLabelText(/adjust playback volume/i);
      const slider = within(sliderRoot).getByRole('slider');
      expect(slider).toHaveAttribute('aria-valuetext', '85%');
    });
  });
});
