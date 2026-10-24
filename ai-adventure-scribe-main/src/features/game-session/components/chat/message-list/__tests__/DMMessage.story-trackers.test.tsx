import { render, screen } from '@testing-library/react';
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

const renderMessage = (context: Record<string, unknown>) =>
  render(
    <DMMessage
      message={{ sender: 'dm', text: 'The grove breathes around you.', context }}
      messageId="dm-1"
      isFirstInGroup
      isLastInGroup
      displayContent="The grove breathes around you."
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );

describe('story tracker line (#1062)', () => {
  it('renders the server-attached tracker line under the narration', () => {
    renderMessage({
      storyTrackers: [
        { name: 'Breath', value: 5, limit: 6 },
        { name: 'Dawn', value: 0, limit: 4 },
      ],
    });

    expect(screen.getByTestId('story-tracker-line')).toHaveTextContent(
      'Breath Clock: 5/6 · Dawn Clock: 0/4',
    );
  });

  it('renders nothing when the field is absent', () => {
    renderMessage({});
    expect(screen.queryByTestId('story-tracker-line')).toBeNull();
  });

  it('drops malformed entries rather than printing a half line', () => {
    renderMessage({
      storyTrackers: [
        { name: 'Breath', value: 5, limit: 6 },
        { name: '', value: 3, limit: 6 },
        { name: 'Dawn', value: 'three', limit: 4 },
        'not-an-entry',
      ],
    });

    expect(screen.getByTestId('story-tracker-line')).toHaveTextContent('Breath Clock: 5/6');
  });
});
