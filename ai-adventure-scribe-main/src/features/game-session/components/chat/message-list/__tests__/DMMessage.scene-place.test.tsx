import { render, type RenderResult } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';
import { findPlaceInText } from '../scene-place';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

import { generateAssetKey } from '@/utils/asset-key';

const setSceneBackground = vi.fn();
let campaignAssets: CampaignAsset[] = [];

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({
    assets: campaignAssets,
    getAsset: (type: string, key: string): CampaignAsset | null =>
      campaignAssets.find((asset) => asset.type === type && asset.key === key) ?? null,
  }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

// Location assets as use-campaign-assets builds them from campaign_chunks rows
// (key = generateAssetKey(entity_name), name = entity_name, imageUrl = metadata.image_url).
const locationChunk = (entityName: string): CampaignAsset => ({
  type: 'location',
  key: generateAssetKey(entityName),
  name: entityName,
  imageUrl: `https://storage.example/campaign-images/${generateAssetKey(entityName)}.png`,
});

const sweetMud = locationChunk('The Sweet Mud');
const heartwood = locationChunk('The Heartwood');
const heartwoodBasin = locationChunk('The Heartwood Basin');

const renderDm = (text: string): RenderResult =>
  render(
    <DMMessage
      message={{ sender: 'dm', text }}
      messageId={text}
      isFirstInGroup
      isLastInGroup
      displayContent={text}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />,
  );

describe('scene art follows the place the DM names (#1026)', () => {
  beforeEach(() => {
    setSceneBackground.mockClear();
    campaignAssets = [sweetMud, heartwood, heartwoodBasin];
  });

  it('moves the scene art from The Sweet Mud to The Heartwood as the party moves', () => {
    renderDm('The reeds part around the Sweet Mud, warm and wet underfoot.');
    expect(setSceneBackground).toHaveBeenLastCalledWith(
      sweetMud.imageUrl,
      'The Sweet Mud',
      'location',
    );

    setSceneBackground.mockClear();
    renderDm('Past the last root, the Heartwood rises from the middle of the basin.');
    expect(setSceneBackground).toHaveBeenLastCalledWith(
      heartwood.imageUrl,
      'The Heartwood',
      'location',
    );
  });

  it('keeps the last image when the named place has no chunk', () => {
    renderDm('The party reaches The Forest of Glass, where nothing has been drawn yet.');
    expect(setSceneBackground).not.toHaveBeenCalled();
  });

  it('prefers a longer name that ends at the same words (The Heartwood Basin)', () => {
    renderDm('In The Heartwood Basin the water is still.');
    expect(setSceneBackground).toHaveBeenLastCalledWith(
      heartwoodBasin.imageUrl,
      'The Heartwood Basin',
      'location',
    );
  });
});

describe('findPlaceInText', () => {
  it('matches the uploader slug rule, so possessives and case still resolve', () => {
    const architect = locationChunk("The Architect's Echo");
    expect(findPlaceInText("the architect's echo waits", [architect])).toBe(architect);
  });

  it('matches whole words only', () => {
    expect(findPlaceInText('Heartwoods grow here', [heartwood])).toBeNull();
  });

  it('prefers the longer name when a shorter one ends the same words', () => {
    const basin = locationChunk('Basin');
    expect(
      findPlaceInText('In The Heartwood Basin the water is still.', [basin, heartwoodBasin]),
    ).toBe(heartwoodBasin);
  });

  it('returns the place named last', () => {
    expect(findPlaceInText('Sweet Mud, then the Heartwood', [sweetMud, heartwood])).toBe(heartwood);
  });
});
