import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

const tavern: CampaignAsset = {
  type: 'location',
  key: 'the-tavern',
  name: 'The Tavern',
  imageUrl: 'https://example.test/tavern.png',
};

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({
    assets: [tavern],
    getAsset: (type: string, key: string) =>
      type === 'location' && key === 'the-tavern' ? tavern : null,
  }),
}));
vi.mock('@/contexts/VoiceContext', () => ({
  useVoiceContext: () => ({
    currentPlayingId: null,
    isPlaying: false,
    isProcessing: false,
    playbackError: null,
    retryMessage: vi.fn(),
    stopMessage: vi.fn(),
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

const text = 'You step into [ASSET:location:the-tavern] and the door swings shut.';

describe('one image per place per message (#1236 D)', () => {
  it('shows a tagged place once, in the scene band, and not again as a tile', () => {
    const { container } = render(
      <DMMessage
        message={{ sender: 'dm', text }}
        messageId="dm-tavern"
        isFirstInGroup
        isLastInGroup
        displayContent={text}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage={false}
        onGenerateImage={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'The Tavern' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open The Tavern full size' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('announces the illustration state in a live region', () => {
    const text2 = 'Rain on the roof, and nothing else.';
    render(
      <DMMessage
        message={{ sender: 'dm', text: text2 }}
        messageId="dm-rain"
        isFirstInGroup
        isLastInGroup
        displayContent={text2}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage
        onGenerateImage={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Illustrating…' });
    expect(button.parentElement).toHaveAttribute('aria-live', 'polite');
  });
});
