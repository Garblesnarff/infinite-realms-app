import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MessageAssetDisplay } from '../MessageAssetDisplay';

const renderDisplay = (
  generatedImage?: React.ComponentProps<typeof MessageAssetDisplay>['generatedImage'],
): ReturnType<typeof render> =>
  render(
    <MessageAssetDisplay assetTags={[]} getAsset={() => null} generatedImage={generatedImage} />,
  );

describe('MessageAssetDisplay scene card (#2256)', () => {
  it('shows no Generate / Scene card and no image when there is no scene art, only a text button', () => {
    const { container } = renderDisplay({ onGenerate: vi.fn() });

    expect(container.textContent).not.toMatch(/Generate/);
    expect(screen.queryByRole('button', { name: /generate scene image/i })).toBeNull();
    const reveal = screen.getByRole('button', { name: 'Show scene art' });
    expect(reveal).toHaveClass('text-xs');
  });

  it('reveals the Generate card after the player taps "Show scene art"', () => {
    const onGenerate = vi.fn();
    renderDisplay({ onGenerate });

    fireEvent.click(screen.getByRole('button', { name: 'Show scene art' }));

    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Generate scene image' }));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it('keeps the card visible while an image is generating, and when generation failed', () => {
    const { unmount } = renderDisplay({ onGenerate: vi.fn(), isGenerating: true });
    expect(screen.getByRole('button', { name: 'Generating scene image' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
    unmount();

    renderDisplay({ onGenerate: vi.fn(), error: 'Image service is busy' });
    expect(screen.getByText('Image service is busy')).toBeInTheDocument();
  });

  it('shows the scene image card and no button when a scene image exists', () => {
    renderDisplay({ url: 'https://example.test/scene.png', onGenerate: vi.fn() });

    expect(screen.getByRole('button', { name: 'View generated scene' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show scene art' })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate scene image/i })).toBeNull();
  });

  it('renders nothing when there is no image and no way to generate one', () => {
    const { container } = renderDisplay({});

    expect(container).toBeEmptyDOMElement();
  });
});
