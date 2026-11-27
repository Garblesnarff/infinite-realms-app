/**
 * #1742: no route line runs through a place or zone label. The layout is in map units, so the
 * same check holds at 390 px and at every zoom. Covers the two collisions in the 390 px
 * screenshot: "Old Toll Bridge" and "The Lowmarsh".
 */
import { describe, expect, it } from 'vitest';

import { FIXTURE_STORY_MAP } from './fixture-graph';
import {
  labelBox,
  layoutMapLabels,
  PLACE_FONT,
  routeHits,
  ZONE_FONT,
  type MapLabel,
  type Segment,
} from '../region-map-labels';
import { FULL_VIEW, MAP_H, MAP_W } from '../region-map-view';
import { deriveStoryMapView, type StoryMapView } from '../useStoryMap';

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
