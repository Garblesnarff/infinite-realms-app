import { FIXTURE_STORY_MAP } from './fixture-graph';

import type { StoryMapGraph, StoryMapPayload } from '../useStoryMap';

/**
 * Tests only. Answers GET /v1/story-map/:campaignId the way the server does: only known
 * places, only visible routes, one row per direction. The campaign id 'no-map' answers 404.
 */
export function payloadFromGraph(graph: StoryMapGraph, campaignId: string): StoryMapPayload {
  const known = new Map(graph.progress.places.map((p) => [p.key, p.state]));
  const shown = graph.places.filter((p) => known.has(p.key));
  const shownKeys = new Set(shown.map((p) => p.key));
  const revealed = new Set(
    graph.progress.revealedEdges.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]),
  );
  const rows = graph.edges
    .filter(
      (e) =>
        shownKeys.has(e.from) &&
        shownKeys.has(e.to) &&
        (!e.hidden || revealed.has(`${e.from}|${e.to}`)),
    )
    .flatMap((e) => [
      { from: e.from, to: e.to, label: e.label },
      { from: e.to, to: e.from, label: e.label },
    ]);
  const currentPlaceKey = graph.progress.currentPlaceKey;
  return {
    campaignId,
    available: true,
    currentPlaceKey,
    zones: graph.zones
      .filter((z) => shown.some((p) => p.zoneKey === z.key))
      .map((z) => ({ key: z.key, name: z.name })),
    places: shown.map((p) => ({
      key: p.key,
      name: p.name,
      zoneKey: p.zoneKey,
      x: p.x,
      y: p.y,
      state: known.get(p.key) ?? 'known',
      current: p.key === currentPlaceKey,
      summary: null,
      imageUrl: p.thumbnailUrl ?? null,
    })),
    edges: rows,
  };
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export async function storyMapResponse(path: string): Promise<Response> {
  const campaignId = decodeURIComponent(path.split('/').pop() ?? '');
  if (campaignId === 'no-map') return new Response(null, { status: 404 });
  return jsonResponse(payloadFromGraph(FIXTURE_STORY_MAP, campaignId));
}
