/**
 * #1742: no route line runs through a place or zone label. The layout is in map units, so the
 * same check holds at 390 px and at every zoom. Covers the two collisions in the 390 px
 * screenshot: "Old Toll Bridge" and "The Lowmarsh".
 */
import { describe, expect, it } from 'vitest';

import { FIXTURE_STORY_MAP } from './fixture-graph';
import {
  insideMap,
  labelBox,
  layoutMapLabels,
  PLACE_FONT,
  routeHits,
  ZONE_FONT,
  type MapLabel,
  type Segment,
} from '../region-map-labels';
import { FULL_VIEW, MAP_H, MAP_W } from '../region-map-view';
import { deriveStoryMapView, type StoryMapPlaceView, type StoryMapView } from '../useStoryMap';

const everyLabelled = (): boolean => true;

const segmentsOf = (view: StoryMapView): Segment[] =>
  view.routes.map((route) => ({
    x1: route.from.x * MAP_W,
    y1: route.from.y * MAP_H,
    x2: route.to.x * MAP_W,
    y2: route.to.y * MAP_H,
  }));

describe('layoutMapLabels: labels stay off route lines (#1742)', () => {
  const view = deriveStoryMapView(FIXTURE_STORY_MAP);
  const labels = layoutMapLabels(view, everyLabelled);
  const routes = segmentsOf(view);

  it('no label is hidden on the fixture map', () => {
    expect([...labels.places.values(), ...labels.zones.values()].some((l) => l.hidden)).toBe(false);
  });

  it('no place label is crossed by a route line', () => {
    const hit = [...labels.places.entries()].filter(([, label]) =>
      routeHits(labelBox(label, PLACE_FONT), routes),
    );
    expect(hit.map(([key]) => key)).toEqual([]);
  });

  it('no zone label is crossed by a route line', () => {
    const hit = [...labels.zones.entries()].filter(([, label]) =>
      routeHits(labelBox(label, ZONE_FONT), routes),
    );
    expect(hit.map(([key]) => key)).toEqual([]);
  });

  it('keeps "Old Toll Bridge" clear of the two routes that meet it', () => {
    const label = labels.places.get('toll-bridge') as MapLabel;
    expect(label.text).toBe('Old Toll Bridge');
    expect(routeHits(labelBox(label, PLACE_FONT), routes)).toBe(false);
  });

  it('keeps "The Lowmarsh" clear of the route that crosses its zone', () => {
    const label = labels.zones.get('lowmarsh') as MapLabel;
    expect(label.text).toBe('The Lowmarsh');
    expect(routeHits(labelBox(label, ZONE_FONT), routes)).toBe(false);
  });

  it('labels only the places the caller asks for', () => {
    const only = layoutMapLabels(view, (place) => place.key === 'toll-bridge');
    expect([...only.places.keys()]).toEqual(['toll-bridge']);
  });

  it('lays out the same way at the full view, whatever the screen width', () => {
    // The label boxes are in map units, so FULL_VIEW is the 390 px case: the view is not zoomed.
    expect(FULL_VIEW.w).toBe(MAP_W);
    expect(layoutMapLabels(view, everyLabelled)).toEqual(labels);
  });
});

const place = (key: string, x: number, y: number, name = 'Edgeford Wharf'): StoryMapPlaceView => ({
  key,
  name,
  zoneKey: null,
  x,
  y,
  thumbnailUrl: null,
  state: 'visited',
  isCurrent: false,
  isNeighbour: false,
});

const viewOf = (
  places: StoryMapPlaceView[],
  routes: StoryMapView['routes'] = [],
): StoryMapView => ({
  zones: [],
  places,
  routes,
  current: null,
});

describe('layoutMapLabels: a label never leaves the map (#1742)', () => {
  // Each edge and corner of the map, as x and y in 0..1.
  const edges: [string, number, number][] = [
    ['right edge', 0.995, 0.5],
    ['left edge', 0.005, 0.5],
    ['top edge', 0.5, 0.01],
    ['bottom edge', 0.5, 0.99],
    ['top right corner', 0.995, 0.01],
    ['top left corner', 0.005, 0.01],
    ['bottom right corner', 0.995, 0.99],
    ['bottom left corner', 0.005, 0.99],
  ];

  it.each(edges)('a place at the %s keeps its label inside the map', (_name, x, y) => {
    const labels = layoutMapLabels(viewOf([place('p', x, y)]), () => true);
    const label = labels.places.get('p') as MapLabel;
    expect(label.hidden).toBe(false);
    expect(insideMap(labelBox(label, PLACE_FONT))).toBe(true);
  });

  it('a place at x = 0.995 gets its label on the left, not cut at the right edge', () => {
    const labels = layoutMapLabels(viewOf([place('p', 0.995, 0.5)]), () => true);
    const label = labels.places.get('p') as MapLabel;
    expect(label.anchor).toBe('end');
    expect(labelBox(label, PLACE_FONT).x2).toBeLessThanOrEqual(400);
  });

  it('a zone at the map edge keeps its label inside the map', () => {
    const zoneView: StoryMapView = {
      zones: [
        {
          key: 'z',
          name: 'The Far Reach',
          places: [place('p', 0.995, 0.5)],
          bounds: { minX: 0.99, minY: 0.45, maxX: 0.995, maxY: 0.55 },
        },
      ],
      places: [place('p', 0.995, 0.5)],
      routes: [],
      current: null,
    };
    const labels = layoutMapLabels(zoneView, () => false);
    const label = labels.zones.get('z') as MapLabel;
    expect(label.hidden).toBe(false);
    expect(insideMap(labelBox(label, ZONE_FONT))).toBe(true);
  });
});

describe('layoutMapLabels: a label with no free spot is hidden (#1742)', () => {
  it('flags the label hidden when route lines block every candidate spot', () => {
    // Horizontal lines across the whole map, one through each candidate's height, block all four
    // candidates for a place at the centre.
    const routes: StoryMapView['routes'] = [135, 145, 155, 165, 175].map((y) => ({
      from: place(`a${y}`, 0, y / 300),
      to: place(`b${y}`, 1, y / 300),
      label: null,
    }));
    const labels = layoutMapLabels(
      viewOf([place('p', 0.5, 0.5, 'Blocked Ford')], routes),
      () => true,
    );
    const label = labels.places.get('p') as MapLabel;
    expect(label.text).toBe('Blocked Ford');
    expect(label.hidden).toBe(true);
  });
});
