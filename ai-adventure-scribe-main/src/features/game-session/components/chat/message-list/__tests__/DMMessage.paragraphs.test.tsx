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

describe('DMMessage paragraph rendering', () => {
  it('renders each paragraph once when the reply contains repeated paragraphs', () => {
    const firstParagraph = 'The archway groans open.';
    const secondParagraph = 'Dust rolls across the floor.';
    const text = [firstParagraph, secondParagraph, firstParagraph, secondParagraph].join('\n\n');

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
      />,
    );

    expect(screen.getAllByText(firstParagraph)).toHaveLength(1);
    expect(screen.getAllByText(secondParagraph)).toHaveLength(1);
  });
});
