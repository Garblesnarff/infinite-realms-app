import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';
import { findPlaceInText } from '../scene-place';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';
import type { ReactNode } from 'react';

import { CampaignAssetsProvider } from '@/contexts/CampaignAssetsContext';

const setSceneBackground = vi.fn();

vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground }),
}));
vi.mock('../MessageAssetDisplay', () => ({ MessageAssetDisplay: () => null }));
vi.mock('../MessageVoicePlayer', () => ({ MessageVoicePlayer: () => null }));

// Only the network edges are stubbed. The campaign-assets loader in
// use-campaign-assets.ts runs for real and maps these rows the way it maps live
// ones: key = generateAssetKey(entity_name), imageUrl = metadata.image_url.
const gardenerLocationRows = [
  {
    entity_name: 'The Sweet Mud',
    chunk_type: 'location',
    metadata: { image_url: 'sweet-mud.png' },
  },
  {
    entity_name: 'The Heartwood',
    chunk_type: 'location',
    metadata: { image_url: 'heartwood.png' },
  },
  {
    entity_name: 'The Heartwood Basin',
    chunk_type: 'location',
    metadata: { image_url: 'heartwood-basin.png' },
  },
];

function queryResult<T>(result: T) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    single: () => Promise.resolve(result),
    then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) =>
      table === 'campaign_chunks'
        ? queryResult({ data: gardenerLocationRows, error: null })
        : queryResult({
            data: { title: "The Gardener's Heir", cover_image_url: null, banner_image_url: null },
            error: null,
          }),
  },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listStarterCharacterTemplates: async () => [] },
}));

const sweetMudText = 'The reeds part around the Sweet Mud, warm underfoot.';
const heartwoodText = 'Past the last root, the Heartwood rises from the middle of the basin.';
const forestText = 'The party reaches The Forest of Glass, where nothing has been drawn yet.';

const dmMessage = (messageId: string, text: string, isLastInGroup = true) => (
  <DMMessage
    message={{ sender: 'dm', text }}
    messageId={messageId}
    isFirstInGroup
    isLastInGroup={isLastInGroup}
    displayContent={text}
    isExpanded={false}
    onToggleExpanded={vi.fn()}
    isGeneratingImage={false}
    onGenerateImage={vi.fn()}
  />
);

const scene = (messages: ReactNode) => (
  <CampaignAssetsProvider starterCampaignId="the-gardeners-heir">{messages}</CampaignAssetsProvider>
);

const urlFor = (name: string) =>
  gardenerLocationRows.find((row) => row.entity_name === name)?.metadata.image_url;

describe('scene art follows the place the DM names (#1026)', () => {
  beforeEach(() => {
    setSceneBackground.mockClear();
  });

  it('moves the scene art from The Sweet Mud to The Heartwood as the party moves', async () => {
    const { rerender } = render(scene(dmMessage('dm-1', sweetMudText)));
    await waitFor(() =>
      expect(setSceneBackground).toHaveBeenLastCalledWith(
        urlFor('The Sweet Mud'),
        'The Sweet Mud',
        'location',
      ),
    );

    rerender(scene([dmMessage('dm-1', sweetMudText, false), dmMessage('dm-2', heartwoodText)]));
    await waitFor(() =>
      expect(setSceneBackground).toHaveBeenLastCalledWith(
        urlFor('The Heartwood'),
        'The Heartwood',
        'location',
      ),
    );
  });

  it('keeps the last image when the named place has no chunk', async () => {
    const { rerender } = render(scene(dmMessage('dm-1', sweetMudText)));
    await waitFor(() => expect(setSceneBackground).toHaveBeenCalledTimes(1));

    rerender(scene([dmMessage('dm-1', sweetMudText, false), dmMessage('dm-3', forestText)]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setSceneBackground).toHaveBeenCalledTimes(1);
  });
});

describe('findPlaceInText', () => {
  const locationOf = (name: string): CampaignAsset => ({
    type: 'location',
    key: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    imageUrl: `${name}.png`,
  });
  const sweetMud = locationOf('The Sweet Mud');
  const heartwood = locationOf('The Heartwood');
  const heartwoodBasin = locationOf('The Heartwood Basin');

  it('matches the uploader slug rule, so possessives and case still resolve', () => {
    const architect = locationOf("The Architect's Echo");
    expect(findPlaceInText("the architect's echo waits", [architect])).toBe(architect);
  });

  it('matches whole words only', () => {
    expect(findPlaceInText('Heartwoods grow here', [heartwood])).toBeNull();
  });

  it('returns the place named last', () => {
    expect(findPlaceInText('Sweet Mud, then the Heartwood', [sweetMud, heartwood])).toBe(heartwood);
  });

  it('prefers the longer name when a shorter one ends the same words', () => {
    const basin = locationOf('Basin');
    expect(
      findPlaceInText('In The Heartwood Basin the water is still.', [basin, heartwoodBasin]),
    ).toBe(heartwoodBasin);
  });
});
