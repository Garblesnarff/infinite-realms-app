import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn(), assets: [] }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const longText = 'A'.repeat(820) + ' [HP 28/28] [Class';

const renderDm = (props: Partial<React.ComponentProps<typeof DMMessage>> = {}) =>
  render(
    <DMMessage
      message={{ sender: 'dm', text: longText }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent={longText}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
      {...props}
    />,
  );

describe('DMMessage clamp-fade contrast (#1562)', () => {
  it('clamps a long narrative and keeps parchment/dm-bubble on the article', () => {
    const { container } = renderDm();

    const narrative = container.querySelector('.dm-narrative');
    expect(narrative).not.toBeNull();
    expect(narrative?.className).toContain('clamp-fade');

    const article = screen.getByLabelText('Dungeon Master message');
    expect(article.className).toContain('ir-parchment');
    expect(article.className).toContain('dm-bubble');
  });
});
