/**
 * #1754: region map, place list, place card and the data hook, on the design §4 fixture.
 * Each describe block names the Done-means item it covers.
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FIXTURE_STORY_MAP } from './fixture-graph';
import { ComposerDraftProvider, useComposerDraft } from '../../chat/composer-draft';
import { PlaceList } from '../PlaceList';
import { centreView, FULL_VIEW, MAP_H, MAP_W, panView, zoomView } from '../region-map-view';
import { RegionMap } from '../RegionMap';
import {
  closeStoryMap,
  openStoryMap,
  resetStoryMapState,
  StoryMapTravelBridge,
  useOpenStoryMapCampaign,
} from '../story-map-state';
import { StoryMapPanel } from '../StoryMapPanel';
import {
  deriveStoryMapView,
  resetStoryMapCache,
  useStoryMap,
  type StoryMapGraph,
} from '../useStoryMap';

vi.mock('@/infrastructure/api/rest-client', async (importOriginal) => {
  const { storyMapResponse } = await import('./story-map-response');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    fetchWithAuth: vi.fn(storyMapResponse),
  };
});

const view = deriveStoryMapView(FIXTURE_STORY_MAP);

afterEach(() => {
  resetStoryMapState();
  resetStoryMapCache();
});

describe('deriveStoryMapView: fog of war (design §8)', () => {
  it('draws only known and visited places, and never an unknown one', () => {
    expect(view.places.map((p) => p.key).sort()).toEqual(
      ['barrow-gate', 'reedhaven', 'sunken-chapel', 'toll-bridge', 'woodcutters-camp'].sort(),
    );
    expect(view.places.find((p) => p.key === 'heartwood')).toBeUndefined();
  });

  it('shows a route only when both ends are known and it is not hidden', () => {
    const routes = view.routes.map((r) => `${r.from.key}-${r.to.key}`).sort();
    expect(routes).toEqual(
      [
        'reedhaven-sunken-chapel',
        'reedhaven-toll-bridge',
        'reedhaven-woodcutters-camp',
        'toll-bridge-barrow-gate',
      ].sort(),
    );
  });

  it('shows a hidden route after the DM reveals it', () => {
    const graph: StoryMapGraph = {
      ...FIXTURE_STORY_MAP,
      progress: {
        ...FIXTURE_STORY_MAP.progress,
        revealedEdges: [{ from: 'barrow-gate', to: 'sunken-chapel' }],
      },
    };
    const routes = deriveStoryMapView(graph).routes.map((r) => `${r.from.key}-${r.to.key}`);
    expect(routes).toContain('sunken-chapel-barrow-gate');
  });

  it('marks the current place and the known neighbours', () => {
    expect(view.current?.key).toBe('toll-bridge');
    expect(
      view.places
        .filter((p) => p.isNeighbour)
        .map((p) => p.key)
        .sort(),
    ).toEqual(['barrow-gate', 'reedhaven']);
  });

  it('groups places by zone and keeps zones with nothing known', () => {
    expect(view.zones.map((z) => z.name)).toEqual([
      'The Lowmarsh',
      'Hollow Hills',
      'Greywood',
      'Ashen Coast',
    ]);
    expect(view.zones.find((z) => z.key === 'ashen-coast')?.places).toEqual([]);
  });
});

describe('useStoryMap: one hook owns the fetch', () => {
  it('loads the graph for a campaign and derives the view', async () => {
    const { result } = renderHook(() => useStoryMap('campaign-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.view?.current?.name).toBe('Old Toll Bridge');
  });

  it('stays loading with no campaign', () => {
    const { result } = renderHook(() => useStoryMap(null));
    expect(result.current.status).toBe('loading');
  });
});

describe('RegionMap: the drawing (Done means 4, 5, 7)', () => {
  it('is one img named with the current place and the count of known places', () => {
    render(<RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />);
    expect(
      screen.getByRole('img', {
        name: 'Region map. You are at Old Toll Bridge. 5 places known.',
      }),
    ).toBeInTheDocument();
  });

  it('dashes known-not-visited pins and fills visited ones, so state is not colour alone', () => {
    const { container } = render(
      <RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />,
    );
    const rim = (key: string): Element | null =>
      container.querySelector(`[data-testid="pin-${key}"] circle[r="7"]`);
    expect(rim('barrow-gate')).toHaveAttribute('stroke-dasharray', '3 2');
    expect(
      within(screen.getByTestId('pin-barrow-gate') as unknown as HTMLElement).getByText('?'),
    ).toBeInTheDocument();
    expect(rim('reedhaven')).not.toHaveAttribute('stroke-dasharray');
    expect(container.querySelector('[data-testid="pin-heartwood"]')).toBeNull();
  });

  it('uses the Table colours: navy ground, gold routes and rims', () => {
    const { container } = render(
      <RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />,
    );
    expect(container.querySelector('svg > rect')).toHaveAttribute('fill', '#0e1a36');
    expect(screen.getByTestId('route-toll-bridge-barrow-gate')).toHaveAttribute(
      'stroke',
      '#d5b070',
    );
  });

  it('draws a zone area only once a place in it is known; else only its name', () => {
    render(<RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />);
    expect(screen.getByTestId('zone-lowmarsh').querySelector('rect')).not.toBeNull();
    const coast = screen.getByTestId('zone-ashen-coast');
    expect(coast.querySelector('rect')).toBeNull();
    expect(coast).toHaveTextContent('Ashen Coast');
  });

  it('labels visited places, and a known place only when picked', () => {
    const { rerender } = render(
      <RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />,
    );
    expect(screen.getByTestId('pin-reedhaven')).toHaveTextContent('Reedhaven');
    expect(screen.getByTestId('pin-barrow-gate')).not.toHaveTextContent('Barrow Gate');
    rerender(<RegionMap view={view} selectedKey="barrow-gate" onSelectPlace={() => {}} />);
    expect(screen.getByTestId('pin-barrow-gate')).toHaveTextContent('Barrow Gate');
  });

  it('pins are 44 px buttons in list order and open the place', async () => {
    const picked: string[] = [];
    render(<RegionMap view={view} selectedKey={null} onSelectPlace={(k) => picked.push(k)} />);
    const pins = view.places.map((p) => screen.getByTestId(`pin-button-${p.key}`));
    for (const pin of pins) expect(pin).toHaveClass('h-11', 'w-11');
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'You are here' })).toHaveFocus();
    await user.tab();
    expect(pins[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard(' ');
    expect(picked).toEqual([view.places[0].key, view.places[1].key]);
    expect(
      screen.getByRole('button', { name: 'Old Toll Bridge, Visited, you are here' }),
    ).toBeInTheDocument();
  });
});

describe('RegionMap: pan, pinch and "You are here" (Done means 3)', () => {
  it('drag moves the view and stays inside the map', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    const moved = panView(zoomed, 40, 0, 200);
    expect(moved.x).toBeCloseTo(zoomed.x - 40 * (zoomed.w / 200));
    expect(panView(FULL_VIEW, 500, 500, 200)).toEqual(FULL_VIEW);
  });

  it('pinch zooms about a point and keeps the 4:3 frame, within limits', () => {
    const zoomed = zoomView(FULL_VIEW, 2, 0, 0);
    expect(zoomed).toEqual({ x: 0, y: 0, w: MAP_W / 2, h: MAP_H / 2 });
    expect(zoomView(FULL_VIEW, 100).w).toBe(MAP_W / 4);
    expect(zoomView(FULL_VIEW, 0.1)).toEqual(FULL_VIEW);
  });

  it('"You are here" centres the current place at the same zoom', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    const centred = centreView(zoomed, { x: 0.5, y: 0.5 });
    expect(centred.x + centred.w / 2).toBeCloseTo(MAP_W / 2);
    expect(centred.y + centred.h / 2).toBeCloseTo(MAP_H / 2);
  });

  it('pointer drag and two-finger pinch change the drawn view; the button recentres', () => {
    render(<RegionMap view={view} selectedKey={null} onSelectPlace={() => {}} />);
    const frame = screen.getByTestId('region-map-frame');
    frame.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }) as DOMRect;
    const svg = screen.getByTestId('region-map');
    const pointer = (type: string, id: number, x: number, y: number): void => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: id });
      fireEvent(frame, event);
    };
    // Pinch out: two fingers move apart, the view zooms in.
    pointer('pointerdown', 1, 150, 150);
    pointer('pointerdown', 2, 250, 150);
    pointer('pointermove', 2, 350, 150);
    pointer('pointerup', 1, 150, 150);
    pointer('pointerup', 2, 350, 150);
    const zoomedWidth = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    expect(zoomedWidth).toBeLessThan(MAP_W);
    // Drag: one finger moves the view.
    const before = svg.getAttribute('viewBox');
    pointer('pointerdown', 3, 200, 150);
    pointer('pointermove', 3, 260, 150);
    pointer('pointerup', 3, 260, 150);
    expect(svg.getAttribute('viewBox')).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'You are here' }));
    const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const here = view.current as NonNullable<typeof view.current>;
    // Centred, unless the map edge stops it.
    const cx = Math.min(MAP_W - w / 2, Math.max(w / 2, here.x * MAP_W));
    const cy = Math.min(MAP_H - h / 2, Math.max(h / 2, here.y * MAP_H));
    expect(x + w / 2).toBeCloseTo(cx);
    expect(y + h / 2).toBeCloseTo(cy);
  });
});

describe('PlaceList: the same content in text (Done means 5, 6, 7)', () => {
  it('groups rows by zone with the state in words and "You are here"', () => {
    render(<PlaceList view={view} onSelectPlace={() => {}} onTravel={() => {}} />);
    const marsh = screen.getByRole('region', { name: 'The Lowmarsh' });
    expect(within(marsh).getByTestId('place-row-toll-bridge')).toHaveTextContent(
      'Old Toll BridgeVisited · You are here',
    );
    expect(within(marsh).getByTestId('place-row-sunken-chapel')).toHaveTextContent(
      'Known, not visited',
    );
    expect(screen.getByRole('region', { name: 'Ashen Coast' })).toHaveTextContent(
      'No places known yet.',
    );
    expect(screen.queryByText('The Heartwood')).not.toBeInTheDocument();
  });

  it('offers Travel here only on known neighbours, never on the current place', () => {
    render(<PlaceList view={view} onSelectPlace={() => {}} onTravel={() => {}} />);
    const travel = screen.getAllByRole('button', { name: /^Travel here/ });
    expect(travel.map((b) => b.getAttribute('aria-label')).sort()).toEqual([
      'Travel here: Barrow Gate',
      'Travel here: Reedhaven',
    ]);
  });

  it('rows and Travel buttons are at least 44 px tall', () => {
    render(<PlaceList view={view} onSelectPlace={() => {}} onTravel={() => {}} />);
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('min-h-11');
  });
});

function ComposerProbe(): React.ReactElement {
  const draft = useComposerDraft();
  return <output data-testid="composer-draft">{draft?.text ?? ''}</output>;
}

function OpenProbe(): React.ReactElement {
  return <output data-testid="open-campaign">{useOpenStoryMapCampaign() ?? 'closed'}</output>;
}

describe('StoryMapPanel (Done means 2, 3, 6, 7)', () => {
  it('rail: map on top, place list under it, no tabs', async () => {
    render(<StoryMapPanel campaignId="campaign-1" layout="rail" />);
    const panel = await screen.findByTestId('story-map-rail');
    await screen.findByRole('img', { name: /Region map/ });
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    const order = [screen.getByTestId('region-map-frame'), screen.getByTestId('place-list')];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(panel).toContainElement(order[1]);
  });

  it('sheet: Map and Places tabs', async () => {
    const user = userEvent.setup();
    render(<StoryMapPanel campaignId="campaign-1" layout="sheet" />);
    const mapTab = await screen.findByRole('tab', { name: 'Map' });
    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('img', { name: /Region map/ })).toBeInTheDocument();
    expect(screen.queryByTestId('place-list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Places' }));
    expect(screen.getByRole('tab', { name: 'Places' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('place-list')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Region map/ })).not.toBeInTheDocument();
  });

  it('keyboard: Tab goes tabs, "You are here", then pins; Enter opens the card', async () => {
    const user = userEvent.setup();
    render(<StoryMapPanel campaignId="campaign-1" layout="sheet" />);
    await screen.findByRole('tab', { name: 'Map' });
    expect(screen.getByTestId('story-map-sheet')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close map' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Map' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Places' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'You are here' })).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId(`pin-button-${view.places[0].key}`)).toHaveFocus();
    await user.keyboard('{Enter}');
    const card = screen.getByTestId('place-card');
    expect(card).toHaveFocus();
    expect(within(card).getByRole('heading', { name: view.places[0].name })).toBeInTheDocument();
  });

  it('a list row opens the card; Travel here is a real button in the card', async () => {
    const user = userEvent.setup();
    render(<StoryMapPanel campaignId="campaign-1" layout="rail" />);
    const row = await screen.findByTestId('place-row-barrow-gate');
    await user.click(within(row).getByRole('button', { name: /^Barrow Gate/ }));
    const card = screen.getByTestId('place-card');
    expect(card).toHaveTextContent('Hollow Hills');
    expect(card).toHaveTextContent('Known, not visited');
    expect(within(card).getByRole('button', { name: 'Travel here: Barrow Gate' })).toHaveClass(
      'min-h-11',
    );
  });

  it('Travel here stages "I travel to <place>." in the composer and sends nothing', async () => {
    const user = userEvent.setup();
    render(
      <ComposerDraftProvider>
        <StoryMapTravelBridge />
        <ComposerProbe />
        <StoryMapPanel campaignId="campaign-1" layout="rail" />
      </ComposerDraftProvider>,
    );
    const row = await screen.findByTestId('place-row-reedhaven');
    await user.click(within(row).getByRole('button', { name: 'Travel here: Reedhaven' }));
    expect(screen.getByTestId('composer-draft')).toHaveTextContent('I travel to Reedhaven.');
  });

  it('Escape closes the map and returns focus to the plaque', async () => {
    const plaque = document.createElement('button');
    document.body.append(plaque);
    render(
      <>
        <OpenProbe />
        <StoryMapPanel campaignId="campaign-1" layout="sheet" />
      </>,
    );
    act(() => openStoryMap('campaign-1', plaque));
    expect(screen.getByTestId('open-campaign')).toHaveTextContent('campaign-1');
    fireEvent.keyDown(await screen.findByRole('tab', { name: 'Map' }), { key: 'Escape' });
    expect(screen.getByTestId('open-campaign')).toHaveTextContent('closed');
    expect(plaque).toHaveFocus();
    plaque.remove();
  });

  it('closing twice is harmless', () => {
    act(() => closeStoryMap());
    act(() => closeStoryMap());
  });
});
