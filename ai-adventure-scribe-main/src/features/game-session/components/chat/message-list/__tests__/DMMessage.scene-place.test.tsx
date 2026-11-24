import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DMMessage } from '../DMMessage';
import { findPlaceInStateLine, findPlaceInText, sceneCandidateTags } from '../scene-place';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';
import type { ReactNode } from 'react';

import { CampaignAssetsProvider } from '@/contexts/CampaignAssetsContext';
import { parseMessageOptions } from '@/utils/parseMessageOptions';

const setSceneBackground = vi.fn();

/**
 * The background the DMMessage effect last set, as the real
 * SceneBackgroundProvider exposes it. The mock updates it synchronously when
 * setSceneBackground is called, so the band's fallback to the last scene art
 * is testable without the provider's fade timers; lastSceneArtUrl/Name follow
 * only location-or-scene sets, mirroring the provider.
 */
const sceneBackgroundState: {
  url: string | null;
  name: string | null;
  type: string | null;
  lastArtUrl: string | null;
  lastArtName: string | null;
} = {
  url: null,
  name: null,
  type: null,
  lastArtUrl: null,
  lastArtName: null,
};

vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({
    currentBackgroundUrl: sceneBackgroundState.url,
    currentAssetName: sceneBackgroundState.name,
    currentAssetType: sceneBackgroundState.type,
    lastSceneArtUrl: sceneBackgroundState.lastArtUrl,
    lastSceneArtName: sceneBackgroundState.lastArtName,
    setSceneBackground: (...args: [string | null, string | null, string | null]) => {
      sceneBackgroundState.url = args[0];
      sceneBackgroundState.name = args[1];
      sceneBackgroundState.type = args[2];
      if (args[2] === 'location' || args[2] === 'scene') {
        sceneBackgroundState.lastArtUrl = args[0];
        sceneBackgroundState.lastArtName = args[1];
      }
      return setSceneBackground(...args);
    },
    isTransitioning: false,
  }),
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
  {
    entity_name: 'Goblin',
    chunk_type: 'monster',
    metadata: { image_url: 'goblin.png' },
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
    sceneBackgroundState.url = null;
    sceneBackgroundState.name = null;
    sceneBackgroundState.type = null;
    sceneBackgroundState.lastArtUrl = null;
    sceneBackgroundState.lastArtName = null;
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

describe('findPlaceInStateLine', () => {
  const locationOf = (name: string): CampaignAsset => ({
    type: 'location',
    key: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    imageUrl: `${name}.png`,
  });
  const sweetMud = locationOf('The Sweet Mud');
  const heartwood = locationOf('The Heartwood');
  const heartwoodBasin = locationOf('The Heartwood Basin');

  it('reads [Place: Name]', () => {
    expect(findPlaceInStateLine('[Place: The Heartwood]', [sweetMud, heartwood])).toBe(heartwood);
  });

  it('reads [Place] Name', () => {
    expect(findPlaceInStateLine('[Place] The Heartwood', [sweetMud, heartwood])).toBe(heartwood);
  });

  it('returns null when the reply carries no state line', () => {
    expect(findPlaceInStateLine('The guard looks at you and waits.', [heartwood])).toBeNull();
  });

  it('returns null when the state line names a place with no chunk', () => {
    expect(findPlaceInStateLine('[Place: The Forest of Glass]', [sweetMud, heartwood])).toBeNull();
  });

  it('takes the last state line when the reply carries two', () => {
    expect(
      findPlaceInStateLine('[Place: The Sweet Mud]\n[Place: The Heartwood]', [sweetMud, heartwood]),
    ).toBe(heartwood);
  });

  it('prefers the longer name when the state line names the Basin', () => {
    expect(findPlaceInStateLine('[Place: The Heartwood Basin]', [heartwood, heartwoodBasin])).toBe(
      heartwoodBasin,
    );
  });

  it('takes the last state line across the two forms, in either order', () => {
    expect(
      findPlaceInStateLine('[Place] The Sweet Mud\n[Place: The Heartwood]', [sweetMud, heartwood]),
    ).toBe(heartwood);
    expect(
      findPlaceInStateLine('[Place: The Sweet Mud]\n[Place] The Heartwood', [sweetMud, heartwood]),
    ).toBe(heartwood);
  });

  it('ignores an empty trailing state line instead of erasing an earlier one', () => {
    expect(findPlaceInStateLine('[Place: The Heartwood]\n[Place: ]', [sweetMud, heartwood])).toBe(
      heartwood,
    );
    expect(findPlaceInStateLine('[Place: The Heartwood]\n[Place]   ', [sweetMud, heartwood])).toBe(
      heartwood,
    );
  });
});

/**
 * A GET /v1/sessions/:id/messages row, the same shape mapMessage in
 * session-messages.ts returns and use-messages.ts maps onto a ChatMessage.
 */
const sessionPayloadMessages = [
  {
    id: 'msg-sweet-mud',
    session_id: 'session-gardeners-heir',
    speaker_type: 'dm' as const,
    speaker_id: null,
    message: sweetMudText,
    context: { location: 'The Sweet Mud' },
    images: null,
    sequence_number: 1,
    timestamp: '2026-10-22T12:00:00.000Z',
    created_at: '2026-10-22T12:00:00.000Z',
    updated_at: '2026-10-22T12:00:00.000Z',
  },
  {
    id: 'msg-heartwood',
    session_id: 'session-gardeners-heir',
    speaker_type: 'dm' as const,
    speaker_id: null,
    message: heartwoodText,
    context: { location: 'The Heartwood' },
    images: null,
    sequence_number: 2,
    timestamp: '2026-10-22T12:05:00.000Z',
    created_at: '2026-10-22T12:05:00.000Z',
    updated_at: '2026-10-22T12:05:00.000Z',
  },
];

// A session-payload row. Production rows carry no context.location (no
// producer writes it), so the location is optional here.
type SessionPayloadRow = Omit<(typeof sessionPayloadMessages)[number], 'context'> & {
  context: { location?: string };
};

// Mirrors use-messages.ts (text = message, sender = speaker_type, context as-is).
const chatFromSessionPayload = (row: SessionPayloadRow) => ({
  id: row.id,
  text: row.message,
  sender: row.speaker_type,
  timestamp: row.timestamp,
  sequenceNumber: row.sequence_number,
  context: row.context,
  images: row.images ?? undefined,
});

const dmFromPayload = (
  row: SessionPayloadRow,
  isLastInGroup: boolean,
  isLatestDmMessage: boolean,
  displayContentOverride?: string,
) => {
  const message = chatFromSessionPayload(row);
  return (
    <DMMessage
      key={message.id}
      message={message}
      messageId={message.id!}
      isFirstInGroup
      isLastInGroup={isLastInGroup}
      isLatestDmMessage={isLatestDmMessage}
      displayContent={displayContentOverride ?? message.text}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      isGeneratingImage={false}
      onGenerateImage={vi.fn()}
    />
  );
};

describe('scene art follows the current location from a real session payload (#1026)', () => {
  beforeEach(() => {
    setSceneBackground.mockClear();
    sceneBackgroundState.url = null;
    sceneBackgroundState.name = null;
    sceneBackgroundState.type = null;
    sceneBackgroundState.lastArtUrl = null;
    sceneBackgroundState.lastArtName = null;
  });

  it('shows The Heartwood image in the scene band after the party leaves The Sweet Mud', async () => {
    const [sweetMud, heartwood] = sessionPayloadMessages;
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(scene([dmFromPayload(sweetMud, false, false), dmFromPayload(heartwood, true, true)]));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );
  });

  it('shows the official context location when the prose does not name it', async () => {
    const contextOnly = {
      ...sessionPayloadMessages[1],
      id: 'msg-heartwood-context-only',
      message: 'The guard looks at you and waits.',
      context: { location: 'The Heartwood' },
    };
    render(scene(dmFromPayload(contextOnly, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );
  });

  it('keeps The Heartwood image in the scene band when the next reply names no place', async () => {
    // Production rows carry no context.location (no producer writes it), so
    // the place is carried by the prose alone — and the guard reply names
    // none. The band above that reply must still show the session's current
    // place, The Heartwood, rather than going blank.
    const guardRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-guard',
      message: 'The guard looks at you and waits.',
      context: {},
      sequence_number: 3,
    };
    const [sweetMud, heartwood] = sessionPayloadMessages.map((row) => ({
      ...row,
      context: {},
    }));
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(scene([dmFromPayload(sweetMud, false, false), dmFromPayload(heartwood, true, true)]));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(heartwood, false, false),
        dmFromPayload(guardRow, true, true),
      ]),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(2),
    );
    expect(screen.getAllByRole('img', { name: 'The Heartwood' })[1]).toHaveAttribute(
      'src',
      urlFor('The Heartwood'),
    );
    // The second band sits above the guard reply itself, not just somewhere in the list.
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(3);
    within(articles[2].parentElement as HTMLElement).getByRole('img', {
      name: 'The Heartwood',
    });
  });

  it('shows the new place art when the move appears only in the [Place] state line', async () => {
    // The hero moves Sweet Mud -> Heartwood, but the move reply's prose names
    // no place; the move appears only in the [Place] state line, after the
    // options. MessageRenderer's parseMessageOptions cuts the narrative at
    // the first option, so displayContent is the prose alone and the band
    // lookup never sees the state line — the band must read the tracked
    // place from the full reply text. Without the fix the band falls back
    // to the last scene art, The Sweet Mud.
    const moveRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-move-state-line',
      message:
        'The guard looks at you and waits.\n\nA. **Search the hall**, looking for anything useful.\nB. **Wait quietly**, listening for footsteps.\n\n[Place: The Heartwood]',
      context: {},
      sequence_number: 2,
    };
    const [sweetMud] = sessionPayloadMessages.map((row) => ({ ...row, context: {} }));
    // displayContent is derived through the real option parser, exactly as
    // MessageRenderer derives it in production.
    const displayContent = parseMessageOptions(moveRow.message).content;
    expect(displayContent).toBe('The guard looks at you and waits.');
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(moveRow, true, true, displayContent),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );
    // The band sits above the move reply itself, not just somewhere in the list.
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(2);
    within(articles[1].parentElement as HTMLElement).getByRole('img', {
      name: 'The Heartwood',
    });
    await waitFor(() =>
      expect(setSceneBackground).toHaveBeenLastCalledWith(
        urlFor('The Heartwood'),
        'The Heartwood',
        'location',
      ),
    );
  });

  it('keeps the previous art when the [Place] state line names a place with no chunk', async () => {
    // The state line names a place with no chunk, so it contributes no
    // candidate and the band falls back to the last scene art, The Sweet Mud.
    const forestRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-forest-state-line',
      message:
        'The guard looks at you and waits.\n\nA. **Search the hall**, looking for anything useful.\nB. **Wait quietly**, listening for footsteps.\n\n[Place: The Forest of Glass]',
      context: {},
      sequence_number: 2,
    };
    const [sweetMud] = sessionPayloadMessages.map((row) => ({ ...row, context: {} }));
    const displayContent = parseMessageOptions(forestRow.message).content;
    expect(displayContent).toBe('The guard looks at you and waits.');
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(forestRow, true, true, displayContent),
      ]),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'The Sweet Mud' })).toHaveLength(2),
    );
    expect(screen.getAllByRole('img', { name: 'The Sweet Mud' })[1]).toHaveAttribute(
      'src',
      urlFor('The Sweet Mud'),
    );
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(2);
    within(articles[1].parentElement as HTMLElement).getByRole('img', {
      name: 'The Sweet Mud',
    });
  });

  it('keeps The Heartwood image in the scene band when the next reply names a place with no chunk', async () => {
    const forestRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-forest',
      message: forestText,
      context: {},
      sequence_number: 3,
    };
    const [sweetMud, heartwood] = sessionPayloadMessages.map((row) => ({
      ...row,
      context: {},
    }));
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(scene([dmFromPayload(sweetMud, false, false), dmFromPayload(heartwood, true, true)]));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(heartwood, false, false),
        dmFromPayload(forestRow, true, true),
      ]),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(2),
    );
    expect(screen.getAllByRole('img', { name: 'The Heartwood' })[1]).toHaveAttribute(
      'src',
      urlFor('The Heartwood'),
    );
    // The second band sits above the forest reply itself, not just somewhere in the list.
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(3);
    within(articles[2].parentElement as HTMLElement).getByRole('img', {
      name: 'The Heartwood',
    });
  });

  it('keeps The Heartwood image after a monster reply takes over the background', async () => {
    // The background effect sets the UI background to the highest-priority
    // asset, so a monster reply makes the *current* background a goblin —
    // but the band's fallback reads the last location-or-scene image the
    // provider kept, so the next place-less reply still shows The Heartwood.
    const monsterRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-goblin',
      message: 'A goblin snarls at you. [ASSET:monster:goblin]',
      context: {},
      sequence_number: 3,
    };
    const guardRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-guard',
      message: 'The guard looks at you and waits.',
      context: {},
      sequence_number: 4,
    };
    const [sweetMud, heartwood] = sessionPayloadMessages.map((row) => ({
      ...row,
      context: {},
    }));
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(scene([dmFromPayload(sweetMud, false, false), dmFromPayload(heartwood, true, true)]));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(heartwood, false, false),
        dmFromPayload(monsterRow, true, true),
      ]),
    );
    await waitFor(() =>
      expect(setSceneBackground).toHaveBeenLastCalledWith('goblin.png', 'Goblin', 'monster'),
    );
    // The monster reply is the latest one, so its band falls back to the
    // Heartwood rather than going blank.
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(2),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(heartwood, false, false),
        dmFromPayload(monsterRow, false, false),
        dmFromPayload(guardRow, true, true),
      ]),
    );
    // Only the latest reply takes the fallback: the monster reply loses its
    // Heartwood band once it is no longer last, and the guard reply takes it.
    await waitFor(() =>
      expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(2),
    );
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(4);
    expect(within(articles[2].parentElement as HTMLElement).queryByRole('img')).toBeNull();
    within(articles[3].parentElement as HTMLElement).getByRole('img', {
      name: 'The Heartwood',
    });
  });

  it('does not re-label an earlier place-less message with the current place', async () => {
    // Only the latest DM message takes the fallback: a place-less reply
    // written before the move keeps no band instead of showing the Heartwood
    // the party reached later.
    const guardRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-guard',
      message: 'The guard looks at you and waits.',
      context: {},
      sequence_number: 2,
    };
    const [sweetMud, heartwood] = sessionPayloadMessages.map((row) => ({
      ...row,
      context: {},
    }));
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(guardRow, false, false),
        dmFromPayload(heartwood, true, true),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );
    expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'The Sweet Mud' })).toHaveLength(1);
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(3);
    // No scene-art band above the earlier guard reply. Scoped to the
    // scene-art names, so a mood/location line in the message cannot satisfy it.
    const guardRoot = articles[1].parentElement as HTMLElement;
    expect(within(guardRoot).queryByRole('img', { name: 'The Heartwood' })).toBeNull();
    expect(within(guardRoot).queryByRole('img', { name: 'The Sweet Mud' })).toBeNull();
  });

  it('does not give the fallback to an earlier DM reply that is last in its group', async () => {
    // In a normal alternating transcript every DM reply is the sole message
    // of its group, so isLastInGroup is true for all of them — it cannot gate
    // the fallback. Only the latest DM message takes it. Under the old gate
    // this reply showed the Sweet Mud band (the background at the time).
    const guardRow = {
      ...sessionPayloadMessages[1],
      id: 'msg-guard-early',
      message: 'The guard looks at you and waits.',
      context: {},
      sequence_number: 2,
    };
    const [sweetMud, heartwood] = sessionPayloadMessages.map((row) => ({
      ...row,
      context: {},
    }));
    const { rerender } = render(scene(dmFromPayload(sweetMud, true, true)));
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Sweet Mud' })).toHaveAttribute(
        'src',
        urlFor('The Sweet Mud'),
      ),
    );

    rerender(
      scene([
        dmFromPayload(sweetMud, false, false),
        dmFromPayload(guardRow, true, false),
        dmFromPayload(heartwood, true, true),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'The Heartwood' })).toHaveAttribute(
        'src',
        urlFor('The Heartwood'),
      ),
    );
    expect(screen.getAllByRole('img', { name: 'The Heartwood' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'The Sweet Mud' })).toHaveLength(1);
    const articles = screen.getAllByLabelText('Dungeon Master message');
    expect(articles).toHaveLength(3);
    const guardRoot = articles[1].parentElement as HTMLElement;
    expect(within(guardRoot).queryByRole('img', { name: 'The Heartwood' })).toBeNull();
    expect(within(guardRoot).queryByRole('img', { name: 'The Sweet Mud' })).toBeNull();
  });
});

describe('sceneCandidateTags', () => {
  const locationOf = (name: string): CampaignAsset => ({
    type: 'location',
    key: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    imageUrl: `${name}.png`,
  });
  const sweetMud = locationOf('The Sweet Mud');
  const heartwood = locationOf('The Heartwood');

  it('appends a matching context location after explicit tags', () => {
    expect(
      sceneCandidateTags(
        [{ type: 'location', key: 'the-sweet-mud' }],
        'The guard looks at you and waits.',
        'The Heartwood',
        [sweetMud, heartwood],
      ),
    ).toEqual([
      { type: 'location', key: 'the-sweet-mud' },
      { type: 'location', key: heartwood.key },
    ]);
  });

  it('puts the official context location ahead of a different place named in prose', () => {
    expect(
      sceneCandidateTags(
        [],
        'The reeds part around the Sweet Mud, warm underfoot.',
        'The Heartwood',
        [sweetMud, heartwood],
      ),
    ).toEqual([
      { type: 'location', key: heartwood.key },
      { type: 'location', key: sweetMud.key },
    ]);
  });

  it('adds nothing for a context location with no matching chunk', () => {
    expect(
      sceneCandidateTags([], 'The party reaches The Forest of Glass.', 'The Forest of Glass', [
        sweetMud,
      ]),
    ).toEqual([]);
  });

  it('puts the [Place] state line ahead of a different place named in prose', () => {
    expect(
      sceneCandidateTags(
        [],
        'The reeds part around the Sweet Mud, warm underfoot.',
        undefined,
        [sweetMud, heartwood],
        'The guard looks at you and waits.\n\n[Place: The Heartwood]',
      ),
    ).toEqual([
      { type: 'location', key: heartwood.key },
      { type: 'location', key: sweetMud.key },
    ]);
  });

  it('adds nothing for a [Place] line naming a place with no chunk', () => {
    expect(
      sceneCandidateTags(
        [],
        'The guard looks at you and waits.',
        undefined,
        [sweetMud],
        'The guard looks at you and waits.\n\n[Place: The Forest of Glass]',
      ),
    ).toEqual([]);
  });
});
