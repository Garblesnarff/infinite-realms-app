import { render } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { MessageVoicePlayer } from '../MessageVoicePlayer';

// Mock the dependent component
vi.mock('@/components/game/voice/DMMessageVoiceControls', () => ({
  DMMessageVoiceControls: ({ messageId }: { messageId: string }) => (
    <div data-testid="voice-controls">Controls for {messageId}</div>
  ),
}));

describe('MessageVoicePlayer', () => {
  const mockMessageId = 'msg-123';
  const mockMessageText = 'Hello world';

  it('renders correctly', () => {
    const { getByTestId, getByText } = render(
      <MessageVoicePlayer
        messageId={mockMessageId}
        messageText={mockMessageText}
      />,
    );

    expect(getByTestId('voice-controls')).toBeDefined();
    expect(getByText(`Controls for ${mockMessageId}`)).toBeDefined();
  });

  it('is memoized', () => {
    const { rerender, getByText } = render(
      <MessageVoicePlayer
        messageId={mockMessageId}
        messageText={mockMessageText}
      />,
    );

    rerender(
      <MessageVoicePlayer
        messageId={mockMessageId}
        messageText={mockMessageText}
      />,
    );

    expect(getByText(`Controls for ${mockMessageId}`)).toBeDefined();
  });
});
