import { useEffect, useMemo, useState } from 'react';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

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

/** One place as GET /v1/story-map/:campaignId sends it (story-map-service.ts, #1762). */
export interface StoryMapPayloadPlace {
  key: string;
  name: string;
  zoneKey: string | null;
  x: number;
  y: number;
  state: PlaceState;
  current: boolean;
  summary: string | null;
  imageUrl: string | null;
}

/** The route response. Only known places and visible routes are in it; each route has one row per direction. */
export interface StoryMapPayload {
  campaignId: string;
  available: boolean;
  currentPlaceKey: string | null;
  zones: { key: string; name: string }[];
  places: StoryMapPayloadPlace[];
  edges: { from: string; to: string; label: string | null }[];
}

/**
 * Turns the server payload into the graph the view model reads. Returns null when the
 * campaign has no map (available: false). The server already hides unknown places and
 * hidden routes, so the progress lists only what it sent, and every route is shown.
 * Two rows for one two-way route become one route.
 */
export function mapStoryMapPayload(payload: StoryMapPayload): StoryMapGraph | null {
  if (!payload.available) return null;
  const routes = new Map<string, StoryMapEdge>();
  for (const row of payload.edges) {
    const id = row.from < row.to ? `${row.from}|${row.to}` : `${row.to}|${row.from}`;
    const existing = routes.get(id);
    if (!existing) {
      routes.set(id, { from: row.from, to: row.to, label: row.label, hidden: false });
    } else if (existing.label == null && row.label != null) {
      existing.label = row.label;
    }
  }
  return {
    zones: payload.zones.map((zone) => ({ key: zone.key, name: zone.name })),
    places: payload.places.map((place) => ({
      key: place.key,
      name: place.name,
      zoneKey: place.zoneKey,
      x: place.x,
      y: place.y,
      thumbnailUrl: place.imageUrl,
    })),
    edges: [...routes.values()],
    progress: {
      currentPlaceKey: payload.currentPlaceKey,
      places: payload.places.map((place) => ({ key: place.key, state: place.state })),
      revealedEdges: [],
    },
  };
}

/**
 * Loads the map for one campaign. A 404 means the campaign has no map (another user's
 * campaign, or a player-made one); it resolves to null with nothing logged. Other failures
 * throw. Nothing here logs.
 */
async function fetchStoryMap(campaignId: string): Promise<StoryMapGraph | null> {
  const res = await fetchWithAuth(`/v1/story-map/${encodeURIComponent(campaignId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`story map request failed: ${res.status}`);
  return mapStoryMapPayload((await res.json()) as StoryMapPayload);
}

/** One request per campaign per session: the plaque's availability check and the panel share it. */
const graphCache = new Map<string, Promise<StoryMapGraph | null>>();

function loadStoryMap(campaignId: string): Promise<StoryMapGraph | null> {
  let entry = graphCache.get(campaignId);
  if (!entry) {
    entry = fetchStoryMap(campaignId).catch((error: unknown) => {
      graphCache.delete(campaignId);
      throw error;
    });
    graphCache.set(campaignId, entry);
  }
  return entry;
}

/** Tests only: forget loaded maps so each test fetches again. */
export function resetStoryMapCache(): void {
  graphCache.clear();
}

export type StoryMapResult =
  | { status: 'loading'; view: null }
  | { status: 'unavailable'; view: null }
  | { status: 'error'; view: null }
  | { status: 'ready'; view: StoryMapView };

interface LoadOutcome {
  campaignId: string;
  graph: StoryMapGraph | null;
  failed: boolean;
}

export function useStoryMap(campaignId: string | null): StoryMapResult {
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  useEffect(() => {
    if (!campaignId) return;
    let live = true;
    loadStoryMap(campaignId).then(
      (graph) => live && setOutcome({ campaignId, graph, failed: false }),
      () => live && setOutcome({ campaignId, graph: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [campaignId]);
  const current = outcome && outcome.campaignId === campaignId ? outcome : null;
  const graph = current?.graph ?? null;
  const view = useMemo(() => (graph ? deriveStoryMapView(graph) : null), [graph]);
  if (!current) return { status: 'loading', view: null };
  if (current.failed) return { status: 'error', view: null };
  if (!view) return { status: 'unavailable', view: null };
  return { status: 'ready', view };
}

/** True only when the campaign has a map the player can open. Drives the plaque button. */
export function useStoryMapAvailable(campaignId: string | null): boolean {
  return useStoryMap(campaignId).status === 'ready';
}
