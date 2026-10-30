import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

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
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));

const text = 'The bell rings twice over the market square.';

const renderMessage = (props: Partial<React.ComponentProps<typeof DMMessage>> = {}) =>
  render(
    <DMMessage
      message={{ sender: 'dm', text }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent={text}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
      {...props}
    />,
  );

describe('DM message scene art (#1236 D)', () => {
  it('shows one Illustrate control in the footer when there is no scene image', () => {
    const onGenerateImage = vi.fn();
    renderMessage({ onGenerateImage });

    fireEvent.click(screen.getByRole('button', { name: 'Illustrate this scene' }));
    expect(onGenerateImage).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /generate scene image/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
  });

  it('hides the Illustrate control once the message has a scene image', () => {
    renderMessage({ imageUrl: 'https://example.test/scene.png' });

    expect(screen.queryByRole('button', { name: 'Illustrate this scene' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Scene' })).toHaveAttribute(
      'src',
      'https://example.test/scene.png',
    );
  });

  it('brings the Illustrate control back when the generated image fails to load', () => {
    renderMessage({ imageUrl: 'https://example.test/dead.png' });

    expect(screen.queryByRole('button', { name: 'Illustrate this scene' })).toBeNull();
    fireEvent.error(screen.getByRole('img', { name: 'Scene' }));
    expect(screen.getByRole('button', { name: 'Illustrate this scene' })).toBeInTheDocument();
  });

  it('shows the scene image above the story text, not under it', () => {
    const { container } = renderMessage({ imageUrl: 'https://example.test/scene.png' });

    const figure = container.querySelector('figure');
    const article = container.querySelector('article');
    expect(figure).not.toBeNull();
    expect(article).not.toBeNull();
    expect(
      figure!.compareDocumentPosition(article!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('offers Retry after a failed illustration', () => {
    const onGenerateImage = vi.fn();
    renderMessage({ onGenerateImage, imageError: 'Image service is busy' });

    fireEvent.click(screen.getByRole('button', { name: 'Couldn’t illustrate · Retry' }));
    expect(onGenerateImage).toHaveBeenCalledTimes(1);
  });

  it('shows the reason when illustration is refused at the session cap', () => {
    renderMessage({ imageError: 'This session has used all of its scene images.' });

    expect(screen.getByText('This session has used all of its scene images.')).toBeInTheDocument();
  });

  it('shows no Illustrate control on a message that is not last in its group', () => {
    renderMessage({ isLastInGroup: false });

    expect(screen.queryByRole('button', { name: 'Illustrate this scene' })).toBeNull();
  });
});
