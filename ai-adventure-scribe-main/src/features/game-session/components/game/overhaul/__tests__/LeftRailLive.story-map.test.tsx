import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openStoryMap, resetStoryMapState } from '../../../story-map/story-map-state';
import { LeftRailLive } from '../LeftRailLive';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => {
  const { storyMapResponse } = await import('../../../story-map/__tests__/story-map-response');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    fetchWithAuth: vi.fn(storyMapResponse),
  };
});

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('@/contexts/CharacterContext', () => ({
  useOptionalCharacter: () => ({ state: { character: { id: 'char-1' } } }),
}));
vi.mock('@/contexts/MessageContext', () => ({ useMessageContext: () => ({ messages: [] }) }));
vi.mock('../useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({ character: {}, campaign: {}, party: [], partyMax: 1, combat: {} }),
}));
vi.mock('../LeftRail', () => ({
  LeftRail: () => null,
  TableCharacterCard: () => <span data-testid="character-card" />,
}));

afterEach(() => resetStoryMapState());

/** #1754 Done means 2: on desktop the map opens in the left rail, SVG on top, list under it. */
describe('Region map in the left rail', () => {
  it('shows nothing until the plaque opens the map', () => {
    render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    expect(screen.queryByTestId('story-map-rail')).not.toBeInTheDocument();
  });

  it('opens in the rail at 1024 px and wider, map above the place list', async () => {
    media.desktop = true;
    render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    act(() => openStoryMap('campaign-1'));
    const rail = await screen.findByTestId('story-map-rail');
    const map = await screen.findByTestId('region-map-frame');
    const list = screen.getByTestId('place-list');
    expect(rail).toContainElement(map);
    expect(map.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('stays out of the rail on narrower screens (the sheet takes it)', () => {
    media.desktop = false;
    render(<LeftRailLive sessionId="s" onOpenSheet={() => {}} />);
    act(() => openStoryMap('campaign-1'));
    expect(screen.queryByTestId('story-map-rail')).not.toBeInTheDocument();
  });
});
