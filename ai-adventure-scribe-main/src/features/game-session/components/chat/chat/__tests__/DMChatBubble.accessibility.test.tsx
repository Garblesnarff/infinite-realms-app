import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { DMChatBubble } from '../DMChatBubble';
import { SimpleMessageProvider } from '../../../../../../contexts/SimpleMessageContext';
import { BrowserRouter } from 'react-router-dom';

// Mock dependencies
vi.mock('@/hooks/use-progressive-voice', () => ({
  useProgressiveVoice: () => ({
    segments: [{ isPlaying: true, character: 'Dungeon Master' }],
    currentSegmentIndex: 0,
    isPlaying: true,
    isProcessing: false,
    volume: 1,
    isMuted: false,
    isVoiceEnabled: true,
    error: null,
    speakAISegments: vi.fn(),
    speakPlainText: vi.fn(),
    stopPlayback: vi.fn(),
    toggleMute: vi.fn(),
    initializeAudioContext: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-local-storage', () => ({
  useLocalStorage: () => [true, vi.fn()],
}));

const mockMessage = {
  id: '1',
  role: 'assistant' as const,
  content: 'Hello, traveler.',
  timestamp: new Date('2024-01-01T12:00:00Z'),
};

describe('DMChatBubble Accessibility', () => {
  it('has accessible attributes for voice controls', () => {
    render(
      <BrowserRouter>
        <SimpleMessageProvider
          messages={[]}
          isLoading={false}
          sendMessage={vi.fn()}
          queueStatus="idle"
        >
          <DMChatBubble message={mockMessage} />
        </SimpleMessageProvider>
      </BrowserRouter>,
    );

    // Play/Pause button
    const playButton = screen.getByRole('button', { name: /pause narration/i });
    expect(playButton).toBeDefined();
    expect(playButton.getAttribute('title')).toBe('Pause');
    expect(playButton.getAttribute('aria-pressed')).toBe('true');

    // Mute button
    const muteButton = screen.getByRole('button', { name: /mute narration/i });
    expect(muteButton).toBeDefined();
    expect(muteButton.getAttribute('title')).toBe('Mute');
    expect(muteButton.getAttribute('aria-pressed')).toBe('false');

    // Progress bar
    const progressBar = screen.getByRole('progressbar', { name: /narration progress/i });
    expect(progressBar).toBeDefined();
    expect(progressBar.getAttribute('aria-valuenow')).toBeDefined();

    // Avatar and Badge
    expect(screen.getByLabelText('Dungeon Master')).toBeDefined();
    expect(screen.getByLabelText('DM Badge')).toBeDefined();

    // Timestamp
    expect(screen.getByLabelText(/sent at/i)).toBeDefined();
  });
});
