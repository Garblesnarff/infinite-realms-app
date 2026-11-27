import { MAP_H, MAP_W } from './region-map-view';

import type { StoryMapPlaceView, StoryMapView } from './useStoryMap';

/** Zones are drawn this far (0..1 of the map) beyond their places. */
const ZONE_PAD = 0.07;
export const PLACE_FONT = 10;
export const ZONE_FONT = 10;

export interface ZoneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box a zone covers in map space, from the places it holds (including unknown ones). */
export function zoneRect(bounds: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}): ZoneRect {
  return {
    x: (bounds.minX - ZONE_PAD) * MAP_W,
    y: (bounds.minY - ZONE_PAD) * MAP_H,
    w: (bounds.maxX - bounds.minX + ZONE_PAD * 2) * MAP_W,
    h: (bounds.maxY - bounds.minY + ZONE_PAD * 2) * MAP_H,
  };
}

/** The part of a zone box that lies inside the map. */
export function clampRect(rect: ZoneRect): ZoneRect {
  const x1 = Math.max(0, rect.x);
  const y1 = Math.max(0, rect.y);
  const x2 = Math.min(MAP_W, rect.x + rect.w);
  const y2 = Math.min(MAP_H, rect.y + rect.h);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export type TextAnchor = 'start' | 'middle' | 'end';

/**
 * One text label: where its baseline starts and how it hangs from that point. `hidden` is set
 * when no candidate spot inside the map is free of route lines and other labels; the map then
 * draws nothing for it. The name stays in the place list and on the pin's accessible name.
 */
export interface MapLabel {
  x: number;
  y: number;
  anchor: TextAnchor;
  text: string;
  hidden: boolean;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Approximate text box in map units: 0.6 em per character, 0.8 em above and 0.2 em below. */
function textBox(label: MapLabel, fontSize: number): Box {
  const w = label.text.length * fontSize * 0.6;
  const x1 =
    label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - w : label.x - w / 2;
  return { x1, y1: label.y - fontSize * 0.8, x2: x1 + w, y2: label.y + fontSize * 0.2 };
}

const overlaps = (a: Box, b: Box): boolean =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

function crosses(a: Segment, b: Segment): boolean {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const d1 = side(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const d2 = side(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const d3 = side(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const d4 = side(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** True when a route line passes through the box, by an end inside it or a crossing edge. */
export function routeHits(box: Box, routes: Segment[]): boolean {
  const edges: Segment[] = [
    { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y1 },
    { x1: box.x2, y1: box.y1, x2: box.x2, y2: box.y2 },
    { x1: box.x2, y1: box.y2, x2: box.x1, y2: box.y2 },
    { x1: box.x1, y1: box.y2, x2: box.x1, y2: box.y1 },
  ];
  return routes.some(
    (route) =>
      (route.x1 >= box.x1 && route.x1 <= box.x2 && route.y1 >= box.y1 && route.y1 <= box.y2) ||
      (route.x2 >= box.x1 && route.x2 <= box.x2 && route.y2 >= box.y1 && route.y2 <= box.y2) ||
      edges.some((edge) => crosses(route, edge)),
  );
}

/** True when the box lies inside the whole map (every zoom shows a part of it). */
export function insideMap(box: Box): boolean {
  return box.x1 >= 0 && box.y1 >= 0 && box.x2 <= MAP_W && box.y2 <= MAP_H;
}

/**
 * The first candidate inside the map that crosses no route line and covers no earlier label.
 * When none qualifies the label is hidden: no fallback is drawn outside the map or on a line.
 */
function pick(
  candidates: Omit<MapLabel, 'text' | 'hidden'>[],
  text: string,
  fontSize: number,
  routes: Segment[],
  placed: Box[],
): MapLabel {
  const options = candidates.map((c) => ({ ...c, text, hidden: false }));
  const clear = options.find((option) => {
    const box = textBox(option, fontSize);
    return (
      insideMap(box) && !routeHits(box, routes) && !placed.some((other) => overlaps(box, other))
    );
  });
  if (!clear) return { ...options[0], hidden: true };
  placed.push(textBox(clear, fontSize));
  return { ...clear, hidden: false };
}

function placeCandidates(place: StoryMapPlaceView): Omit<MapLabel, 'text' | 'hidden'>[] {
  const cx = place.x * MAP_W;
  const cy = place.y * MAP_H;
  // Below and above the pin first; then beside it, level, lower and higher, so a pin on an
  // edge still has a spot inside the map.
  return [
    { x: cx, y: cy + 20, anchor: 'middle' },
    { x: cx, y: cy - 12, anchor: 'middle' },
    { x: cx + 11, y: cy + 4, anchor: 'start' },
    { x: cx - 11, y: cy + 4, anchor: 'end' },
    { x: cx + 11, y: cy + 14, anchor: 'start' },
    { x: cx - 11, y: cy + 14, anchor: 'end' },
    { x: cx + 11, y: cy - 4, anchor: 'start' },
    { x: cx - 11, y: cy - 4, anchor: 'end' },
  ];
}

function zoneCandidates(rect: ZoneRect, known: boolean): Omit<MapLabel, 'text' | 'hidden'>[] {
  const corners: Omit<MapLabel, 'text' | 'hidden'>[] = [
    { x: rect.x + 8, y: rect.y + 13, anchor: 'start' },
    { x: rect.x + 8, y: rect.y + rect.h - 6, anchor: 'start' },
    { x: rect.x + rect.w - 8, y: rect.y + 13, anchor: 'end' },
    { x: rect.x + rect.w - 8, y: rect.y + rect.h - 6, anchor: 'end' },
  ];
  const centre: Omit<MapLabel, 'text' | 'hidden'> = {
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2,
    anchor: 'middle',
  };
  return known ? corners : [centre, ...corners];
}

export interface MapLabels {
  zones: Map<string, MapLabel>;
  places: Map<string, MapLabel>;
}

/**
 * Where each zone and place label goes, so that no route line runs through a label (#1742).
 * Zone labels are placed first, then the labelled places, each avoiding the labels placed
 * before it. The map is in map units, so the result is the same at every screen width.
 */
export function layoutMapLabels(
  view: StoryMapView,
  isLabelled: (place: StoryMapPlaceView) => boolean,
): MapLabels {
  const routes: Segment[] = view.routes.map((route) => ({
    x1: route.from.x * MAP_W,
    y1: route.from.y * MAP_H,
    x2: route.to.x * MAP_W,
    y2: route.to.y * MAP_H,
  }));
  const placed: Box[] = [];
  const zones = new Map<string, MapLabel>();
  for (const zone of view.zones) {
    if (!zone.bounds) continue;
    const known = zone.places.length > 0;
    // A zone box can run past the map edge; its label is placed inside the part that shows.
    const rect = clampRect(zoneRect(zone.bounds));
    zones.set(zone.key, pick(zoneCandidates(rect, known), zone.name, ZONE_FONT, routes, placed));
  }
  const places = new Map<string, MapLabel>();
  for (const place of view.places) {
    if (!isLabelled(place)) continue;
    places.set(place.key, pick(placeCandidates(place), place.name, PLACE_FONT, routes, placed));
  }
  return { zones, places };
}

/** Exported for tests: the box a label covers, in map units. */
export function labelBox(label: MapLabel, fontSize: number): Box {
  return textBox(label, fontSize);
}
