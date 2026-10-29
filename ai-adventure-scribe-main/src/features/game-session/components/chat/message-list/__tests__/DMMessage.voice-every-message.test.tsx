import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

vi.mock('@/contexts/VoiceContext', () => ({
  useVoiceContext: () => ({
    currentPlayingId: null,
    isPlaying: false,
    isProcessing: false,
    playbackError: null,
    retryMessage: vi.fn(),
    playMessage: vi.fn(),
    pauseMessage: vi.fn(),
    volume: 1,
    isMuted: false,
    setVolume: vi.fn(),
    toggleMute: vi.fn(),
  }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));

const text = 'The bell rings twice over the market square.';

describe('DM message voice control (#1236 C)', () => {
  it('shows Listen on a DM message that is not the last in its group', () => {
    render(
      <DMMessage
        message={{ sender: 'dm', text }}
        messageId="dm-earlier"
        isFirstInGroup
        isLastInGroup={false}
        displayContent={text}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage={false}
        onGenerateImage={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /listen to this message/i })).toBeInTheDocument();
    expect(screen.getByText('Listen')).toBeInTheDocument();
  });
});
