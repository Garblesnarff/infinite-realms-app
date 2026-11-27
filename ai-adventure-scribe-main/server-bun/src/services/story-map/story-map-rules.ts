/**
 * Story map rules (#1753): pure functions over one campaign's map and one player's progress.
 * No database here; story-map-service.ts loads the rows and writes the results.
 */

export interface MapPlace {
  placeKey: string;
  name: string;
  zoneKey: string | null;
  x: number;
  y: number;
}

export interface MapEdge {
  fromKey: string;
  toKey: string;
  label: string | null;
  hidden: boolean;
}

export interface ProgressRow {
  placeKey: string;
  state: 'known' | 'visited';
  visitedAt: Date | null;
}

export interface RevealedEdge {
  fromKey: string;
  toKey: string;
}

export interface MapProgress {
  rows: ProgressRow[];
  revealed: RevealedEdge[];
}

const edgeId = (from: string, to: string): string => `${from}\u0000${to}`;

/** The current place: the 'visited' row with the newest visited_at. */
export function currentPlaceKey(progress: MapProgress): string | null {
  let best: ProgressRow | null = null;
  for (const row of progress.rows) {
    if (row.state !== 'visited' || !row.visitedAt) continue;
    if (!best || row.visitedAt.getTime() > (best.visitedAt as Date).getTime()) best = row;
  }
  return best?.placeKey ?? null;
}

/** Edges the player can see: not hidden, or hidden and revealed. */
export function usableEdges(edges: MapEdge[], progress: MapProgress): MapEdge[] {
  const revealed = new Set(progress.revealed.map((edge) => edgeId(edge.fromKey, edge.toKey)));
  return edges.filter((edge) => !edge.hidden || revealed.has(edgeId(edge.fromKey, edge.toKey)));
}

/**
 * Same-zone neighbours (strategist decision on #1762): places in one zone reach each other
 * without a route line; routes are for paths between zones and hidden paths. A place with no
 * zone has no same-zone neighbours.
 */
export function sameZone(a: MapPlace | undefined, b: MapPlace | undefined): boolean {
  return Boolean(a && b && a.placeKey !== b.placeKey && a.zoneKey && a.zoneKey === b.zoneKey);
}

export type PlaceDecision =
  | { accepted: true; placeKey: string; via: 'current' | 'neighbour' | 'opening' }
  | {
      accepted: false;
      reason: 'not_a_string' | 'unknown_key' | 'not_reachable';
    };

/**
 * Accept a DM `place` only when it is a key of this campaign's map AND it is the current place,
 * a neighbour of the current place, or a neighbour of any visited place. Hidden routes count
 * here: the DM names the place, and that is how a secret route is found. When the player has
 * visited nothing yet, any key is accepted: that is the opening scene.
 */
export function decidePlace(
  candidate: unknown,
  places: MapPlace[],
  edges: MapEdge[],
  progress: MapProgress,
): PlaceDecision {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return { accepted: false, reason: 'not_a_string' };
  }
  const key = candidate.trim();
  if (!places.some((place) => place.placeKey === key)) {
    return { accepted: false, reason: 'unknown_key' };
  }
  const visited = new Set(
    progress.rows.filter((row) => row.state === 'visited').map((row) => row.placeKey),
  );
  if (visited.size === 0) return { accepted: true, placeKey: key, via: 'opening' };
  const current = currentPlaceKey(progress);
  if (key === current) return { accepted: true, placeKey: key, via: 'current' };
  const byKey = new Map(places.map((place) => [place.placeKey, place]));
  const reachable =
    edges.some((edge) => visited.has(edge.fromKey) && edge.toKey === key) ||
    [...visited].some((from) => sameZone(byKey.get(from), byKey.get(key)));
  return reachable
    ? { accepted: true, placeKey: key, via: 'neighbour' }
    : { accepted: false, reason: 'not_reachable' };
}

/**
 * What one accepted move writes: the place becomes visited; its neighbours by a usable route
 * become known. When no usable route leads to the place from a visited place but a hidden one
 * does, that hidden route is revealed (both directions, where both exist): the hero found it.
 * The route from the current place is preferred over one from another visited place.
 */
export function planMove(
  placeKey: string,
  edges: MapEdge[],
  progress: MapProgress,
  places: MapPlace[] = [],
): { visit: string; know: string[]; reveal: RevealedEdge[] } {
  const byKey = new Map(places.map((place) => [place.placeKey, place]));
  const visited = new Set(
    progress.rows.filter((row) => row.state === 'visited').map((row) => row.placeKey),
  );
  const current = currentPlaceKey(progress);
  const usable = new Set(usableEdges(edges, progress).map((e) => edgeId(e.fromKey, e.toKey)));
  const into = edges.filter((edge) => edge.toKey === placeKey && visited.has(edge.fromKey));
  const reveal: RevealedEdge[] = [];
  // A same-zone place needs no route, so nothing hidden is found by walking to it.
  const zoneReach = [...visited].some((from) => sameZone(byKey.get(from), byKey.get(placeKey)));
  if (!zoneReach && !into.some((edge) => usable.has(edgeId(edge.fromKey, edge.toKey)))) {
    const found = into.find((edge) => edge.fromKey === current) ?? into[0];
    if (found) {
      for (const [from, to] of [
        [found.fromKey, found.toKey],
        [found.toKey, found.fromKey],
      ]) {
        if (edges.some((edge) => edge.fromKey === from && edge.toKey === to)) {
          reveal.push({ fromKey: from, toKey: to });
        }
      }
    }
  }
  const after: MapProgress = { rows: progress.rows, revealed: [...progress.revealed, ...reveal] };
  const know = [
    ...usableEdges(edges, after)
      .filter((edge) => edge.fromKey === placeKey && edge.toKey !== placeKey)
      .map((edge) => edge.toKey),
    ...places
      .filter((place) => sameZone(byKey.get(placeKey), place))
      .map((place) => place.placeKey),
  ];
  return { visit: placeKey, know: [...new Set(know)], reveal };
}

export interface VisibleMap {
  currentPlaceKey: string | null;
  places: Array<MapPlace & { state: 'known' | 'visited'; current: boolean }>;
  edges: Array<{ fromKey: string; toKey: string; label: string | null }>;
}

/** What the player may see: known and visited places only, and usable routes between them. */
export function visibleMap(
  places: MapPlace[],
  edges: MapEdge[],
  progress: MapProgress,
): VisibleMap {
  const state = new Map(progress.rows.map((row) => [row.placeKey, row.state]));
  const current = currentPlaceKey(progress);
  const shown = places
    .filter((place) => state.has(place.placeKey))
    .map((place) => ({
      ...place,
      state: state.get(place.placeKey) as 'known' | 'visited',
      current: place.placeKey === current,
    }));
  const shownKeys = new Set(shown.map((place) => place.placeKey));
  return {
    currentPlaceKey: current,
    places: shown,
    edges: usableEdges(edges, progress)
      .filter((edge) => shownKeys.has(edge.fromKey) && shownKeys.has(edge.toKey))
      .map(({ fromKey, toKey, label }) => ({ fromKey, toKey, label })),
  };
}

/**
 * The <story_map> block for the DM prompt (starter campaigns only). Before the first visit it
 * lists every place so the opening scene can be placed; after it, the current place, the known
 * places, and the places one route away from any visited place (hidden routes included, marked,
 * so the DM can let the hero find them).
 */
export function storyMapPromptBlock(
  places: MapPlace[],
  edges: MapEdge[],
  progress: MapProgress,
): string {
  const byKey = new Map(places.map((place) => [place.placeKey, place]));
  const label = (key: string): string => `${key} (${byKey.get(key)?.name ?? key})`;
  const lines = ['<story_map>'];
  const current = currentPlaceKey(progress);
  if (!current) {
    lines.push('The hero has not been placed on the map yet. Places:');
    for (const place of places) lines.push(`- ${label(place.placeKey)}`);
  } else {
    lines.push(`The hero is at ${label(current)}.`);
    const state = new Map(progress.rows.map((row) => [row.placeKey, row.state]));
    const visited = new Set(
      progress.rows.filter((row) => row.state === 'visited').map((row) => row.placeKey),
    );
    const known = places.filter((place) => state.has(place.placeKey));
    lines.push('Known places:');
    for (const place of known)
      lines.push(`- ${label(place.placeKey)}: ${state.get(place.placeKey)}`);
    const usable = new Set(usableEdges(edges, progress).map((e) => edgeId(e.fromKey, e.toKey)));
    const next = edges.filter((edge) => visited.has(edge.fromKey) && edge.toKey !== current);
    const seen = new Set<string>();
    lines.push('Routes from visited places:');
    for (const edge of next) {
      const id = edgeId(edge.fromKey, edge.toKey);
      if (seen.has(id)) continue;
      seen.add(id);
      const secret = usable.has(id) ? '' : ' [hidden: the hero must find it]';
      const via = edge.label ? ` by ${edge.label}` : '';
      lines.push(`- ${label(edge.fromKey)} -> ${label(edge.toKey)}${via}${secret}`);
    }
    // Same-zone neighbours need no route line (strategist decision on #1762).
    const zoneSeen = new Set<string>();
    for (const from of visited) {
      for (const place of places) {
        if (place.placeKey === current || !sameZone(byKey.get(from), place)) continue;
        if (seen.has(edgeId(from, place.placeKey)) || zoneSeen.has(place.placeKey)) continue;
        zoneSeen.add(place.placeKey);
        lines.push(`- ${label(from)} -> ${label(place.placeKey)} (same zone)`);
      }
    }
  }
  lines.push(
    'When this turn ends with the hero at one of these places, set `place` to its key. ' +
      'Do not name a place that is not listed here as somewhere the hero can go.',
  );
  lines.push('</story_map>');
  return lines.join('\n');
}

/**
 * The DM's `place` as a key, or null when the reply carries none. On the Haiku tool path an
 * optional `null` is already dropped, but the string "null" (Haiku's spelling of "no value")
 * survives for a string field; it, an empty string, and any non-string are absent here.
 */
export function normalizeDmPlace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' || trimmed.toLowerCase() === 'null' ? null : trimmed;
}
