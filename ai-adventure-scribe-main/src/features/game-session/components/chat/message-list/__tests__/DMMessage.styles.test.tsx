import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn() }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

const text = 'Moonlight spills across the ruins.';

const renderDm = (props: Partial<React.ComponentProps<typeof DMMessage>> = {}) =>
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

describe('DMMessage styles (#88)', () => {
  it('renders the navy bubble, not the purple gradient', () => {
    const { container } = renderDm();

    const bubble = screen.getByLabelText('Dungeon Master message');
    expect(bubble.className).toMatch(/bg-infinite-dark-lighter/);
    expect(bubble.className).toMatch(/rounded-2xl rounded-tl-\[4px\]/);
    expect(bubble.className).toMatch(/max-w-\[72ch\]/);
    expect(bubble.className).toMatch(/px-\[18px\] py-3\.5/);
    expect(bubble.className).not.toMatch(/from-\[#2d1155\]/);
    expect(bubble.className).not.toMatch(/bg-gradient-to-br/);
    expect(container.querySelector('.dm-narrative')).toBeNull();
  });

  it('renders narration with the ir-narr token', () => {
    const { container } = renderDm();

    expect(container.querySelector('.ir-narr')).not.toBeNull();
  });

  it('labels the first message in a group "Dungeon Master", above the bubble', () => {
    renderDm();

    const label = screen.getByText('Dungeon Master');
    expect(label.className).toMatch(/text-infinite-gold/);
    expect(label.className).toMatch(/uppercase/);
  });

  it('shows no label on later messages in the group', () => {
    renderDm({ isFirstInGroup: false });

    expect(screen.queryByText('Dungeon Master')).not.toBeInTheDocument();
  });
});
