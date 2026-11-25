import { useEffect, useMemo, useState } from 'react';

import { FIXTURE_STORY_MAP } from './fixture-graph';

/** One place of a starter campaign (design §4, story_map_places). x and y run 0..1. */
export interface StoryMapPlace {
  key: string;
  name: string;
  zoneKey: string | null;
  x: number;
  y: number;
  thumbnailUrl?: string | null;
}

/** A route between two places (design §4, story_map_edges). */
export interface StoryMapEdge {
  from: string;
  to: string;
  label: string | null;
  hidden: boolean;
}

/** What the player's campaign has found (design §4, story_map_progress + revealed edges). */
export interface StoryMapProgress {
  currentPlaceKey: string | null;
  places: { key: string; state: 'known' | 'visited' }[];
  revealedEdges: { from: string; to: string }[];
}

export interface StoryMapGraph {
  zones: { key: string; name: string }[];
  places: StoryMapPlace[];
  edges: StoryMapEdge[];
  progress: StoryMapProgress;
}

export type PlaceState = 'visited' | 'known';

export interface StoryMapPlaceView extends StoryMapPlace {
  state: PlaceState;
  isCurrent: boolean;
  /** Joined to the current place by a known route, so the player can travel there. */
  isNeighbour: boolean;
}

export interface StoryMapZoneView {
  key: string;
  name: string;
  /** Places of this zone the player knows, in list order. */
  places: StoryMapPlaceView[];
  /** Bounding box (0..1) of every place of the zone in the payload. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

export interface StoryMapView {
  zones: StoryMapZoneView[];
  /** Known and visited places only; unknown places are not drawn (design §8). */
  places: StoryMapPlaceView[];
  routes: { from: StoryMapPlaceView; to: StoryMapPlaceView; label: string | null }[];
  current: StoryMapPlaceView | null;
}

export const PLACE_STATE_WORDS: Record<PlaceState, string> = {
  visited: 'Visited',
  known: 'Known, not visited',
};

/** A place can be travelled to when a known route joins it to where the player stands. */
export const canTravelTo = (place: StoryMapPlaceView): boolean =>
  place.isNeighbour && !place.isCurrent;

const edgeId = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Fog of war per design §4 and §8: what the player may see of the graph. */
export function deriveStoryMapView(graph: StoryMapGraph): StoryMapView {
  const stateByKey = new Map(graph.progress.places.map((p) => [p.key, p.state]));
  const revealed = new Set(graph.progress.revealedEdges.map((e) => edgeId(e.from, e.to)));
  const routeEdges = graph.edges.filter(
    (edge) =>
      stateByKey.has(edge.from) &&
      stateByKey.has(edge.to) &&
      (!edge.hidden || revealed.has(edgeId(edge.from, edge.to))),
  );
  const current = graph.progress.currentPlaceKey;
  const neighbours = new Set<string>();
  for (const edge of routeEdges) {
    if (edge.from === current) neighbours.add(edge.to);
    if (edge.to === current) neighbours.add(edge.from);
  }
  const places: StoryMapPlaceView[] = graph.places
    .filter((place) => stateByKey.has(place.key))
    .map((place) => ({
      ...place,
      state: stateByKey.get(place.key) as PlaceState,
      isCurrent: place.key === current,
      isNeighbour: neighbours.has(place.key),
    }));
  const byKey = new Map(places.map((place) => [place.key, place]));
  const zoneOf = (key: string | null): string => key ?? '';
  const zones: StoryMapZoneView[] = [
    ...graph.zones,
    ...(graph.places.some((p) => p.zoneKey == null) ? [{ key: '', name: 'Elsewhere' }] : []),
  ].map((zone) => {
    const all = graph.places.filter((place) => zoneOf(place.zoneKey) === zone.key);
    return {
      key: zone.key,
      name: zone.name,
      places: places.filter((place) => zoneOf(place.zoneKey) === zone.key),
      bounds: all.length
        ? {
            minX: Math.min(...all.map((p) => p.x)),
            minY: Math.min(...all.map((p) => p.y)),
            maxX: Math.max(...all.map((p) => p.x)),
            maxY: Math.max(...all.map((p) => p.y)),
          }
        : null,
    };
  });
  return {
    zones,
    places: zones.flatMap((zone) => zone.places),
    routes: routeEdges.map((edge) => ({
      from: byKey.get(edge.from) as StoryMapPlaceView,
      to: byKey.get(edge.to) as StoryMapPlaceView,
      label: edge.label,
    })),
    current: current ? (byKey.get(current) ?? null) : null,
  };
}

/**
 * The one place the client reads the story map. #1754 builds on a fixture; when
 * GET /v1/story-map/:campaignId lands (#1753), only this function changes.
 */
async function fetchStoryMap(_campaignId: string): Promise<StoryMapGraph> {
  return FIXTURE_STORY_MAP;
}

export type StoryMapResult =
  | { status: 'loading'; view: null }
  | { status: 'error'; view: null }
  | { status: 'ready'; view: StoryMapView };

export function useStoryMap(campaignId: string | null): StoryMapResult {
  const [graph, setGraph] = useState<StoryMapGraph | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!campaignId) return;
    let live = true;
    setFailed(false);
    fetchStoryMap(campaignId).then(
      (next) => live && setGraph(next),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [campaignId]);
  const view = useMemo(() => (graph ? deriveStoryMapView(graph) : null), [graph]);
  if (failed) return { status: 'error', view: null };
  return view ? { status: 'ready', view } : { status: 'loading', view: null };
}
