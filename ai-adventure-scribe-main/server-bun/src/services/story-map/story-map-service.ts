/**
 * Story map service (#1753): loads one campaign's map and the player's progress, builds the
 * DM's <story_map> block, applies the DM's `place`, and reads the map for the client.
 *
 * RLS is off (AGENTS §4): every read and write of player rows goes through a campaign the
 * caller owns (`campaigns.user_id`). Player-made campaigns (no starter campaign) and sessions
 * with no campaign get no map and write nothing.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

import {
  decidePlace,
  planMove,
  storyMapPromptBlock,
  visibleMap,
  type MapEdge,
  type MapPlace,
  type MapProgress,
  type PlaceDecision,
} from './story-map-rules.js';
import { db } from '../../../../db/client';
import {
  campaignChunks,
  campaigns,
  gameSessions,
  storyMapEdges,
  storyMapPlaces,
  storyMapProgress,
  storyMapRevealedEdges,
} from '../../../../db/schema/index';
import { generateAssetKey } from '../../../../src/utils/asset-key';

export interface MapScope {
  campaignId: string;
  starterCampaignId: string;
  sessionId: string | null;
}

/** The session's campaign and starter campaign, for the owner only; null when there is no map. */
export async function loadSessionMapScope(
  sessionId: string,
  userId: string,
): Promise<MapScope | null> {
  const [row] = await db
    .select({
      campaignId: gameSessions.campaignId,
      starterCampaignId: gameSessions.starterCampaignId,
    })
    .from(gameSessions)
    .innerJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
    .where(and(eq(gameSessions.id, sessionId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!row?.campaignId || !row.starterCampaignId) return null;
  return { campaignId: row.campaignId, starterCampaignId: row.starterCampaignId, sessionId };
}

/**
 * A campaign's scope by campaign id, for the owner only. The starter campaign comes from the
 * campaign's newest session that has one. Undefined = not the caller's campaign (or no such
 * campaign); null = the caller's campaign, but it has no starter map (player-made).
 */
export async function loadCampaignMapScope(
  campaignId: string,
  userId: string,
): Promise<MapScope | null | undefined> {
  const [owned] = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!owned) return undefined;
  const [session] = await db
    .select({ starterCampaignId: gameSessions.starterCampaignId })
    .from(gameSessions)
    .where(and(eq(gameSessions.campaignId, campaignId), isNotNull(gameSessions.starterCampaignId)))
    .orderBy(desc(gameSessions.createdAt))
    .limit(1);
  if (!session?.starterCampaignId) return null;
  return { campaignId, starterCampaignId: session.starterCampaignId, sessionId: null };
}

async function loadMap(
  starterCampaignId: string,
): Promise<{ places: MapPlace[]; edges: MapEdge[] }> {
  const places = await db
    .select({
      placeKey: storyMapPlaces.placeKey,
      name: storyMapPlaces.name,
      zoneKey: storyMapPlaces.zoneKey,
      x: storyMapPlaces.x,
      y: storyMapPlaces.y,
    })
    .from(storyMapPlaces)
    .where(eq(storyMapPlaces.campaignId, starterCampaignId))
    .orderBy(storyMapPlaces.placeKey);
  const edges = await db
    .select({
      fromKey: storyMapEdges.fromKey,
      toKey: storyMapEdges.toKey,
      label: storyMapEdges.label,
      hidden: storyMapEdges.hidden,
    })
    .from(storyMapEdges)
    .where(eq(storyMapEdges.campaignId, starterCampaignId));
  return { places, edges };
}

/** Progress for a campaign the caller already proved they own (scope came from an owner query). */
async function loadProgress(scope: MapScope): Promise<MapProgress> {
  const rows = await db
    .select({
      placeKey: storyMapProgress.placeKey,
      state: storyMapProgress.state,
      visitedAt: storyMapProgress.visitedAt,
    })
    .from(storyMapProgress)
    .where(eq(storyMapProgress.campaignId, scope.campaignId));
  const revealed = await db
    .select({ fromKey: storyMapRevealedEdges.fromKey, toKey: storyMapRevealedEdges.toKey })
    .from(storyMapRevealedEdges)
    .where(eq(storyMapRevealedEdges.campaignId, scope.campaignId));
  return {
    rows: rows.map((row) => ({
      placeKey: row.placeKey,
      state: row.state === 'visited' ? 'visited' : 'known',
      visitedAt: row.visitedAt,
    })),
    revealed,
  };
}

/** The DM's <story_map> block for this session, or null when it has no map. */
export async function loadStoryMapDirective(input: {
  sessionId: string;
  userId: string;
}): Promise<string | null> {
  const scope = await loadSessionMapScope(input.sessionId, input.userId);
  if (!scope) return null;
  const { places, edges } = await loadMap(scope.starterCampaignId);
  if (places.length === 0) return null;
  return storyMapPromptBlock(places, edges, await loadProgress(scope));
}

export type ApplyPlaceResult = PlaceDecision | { accepted: false; reason: 'no_map' };

/**
 * Apply the DM's `place` for this session's campaign. Anything that does not fit the map is
 * dropped (the caller logs it); it is never an error.
 */
export async function applyStoryMapPlace(input: {
  sessionId: string;
  userId: string;
  place: unknown;
}): Promise<ApplyPlaceResult> {
  const scope = await loadSessionMapScope(input.sessionId, input.userId);
  if (!scope) return { accepted: false, reason: 'no_map' };
  const { places, edges } = await loadMap(scope.starterCampaignId);
  if (places.length === 0) return { accepted: false, reason: 'no_map' };
  const progress = await loadProgress(scope);
  const decision = decidePlace(input.place, places, edges, progress);
  if (!decision.accepted) return decision;

  const move = planMove(decision.placeKey, edges, progress);
  await db.transaction(async (tx) => {
    await tx
      .insert(storyMapProgress)
      .values({
        campaignId: scope.campaignId,
        placeKey: move.visit,
        state: 'visited',
        firstSessionId: input.sessionId,
        visitedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [storyMapProgress.campaignId, storyMapProgress.placeKey],
        set: { state: 'visited', visitedAt: sql`now()` },
      });
    if (move.know.length > 0) {
      await tx
        .insert(storyMapProgress)
        .values(
          move.know.map((placeKey) => ({
            campaignId: scope.campaignId,
            placeKey,
            state: 'known',
            firstSessionId: input.sessionId,
          })),
        )
        .onConflictDoNothing({ target: [storyMapProgress.campaignId, storyMapProgress.placeKey] });
    }
    if (move.reveal.length > 0) {
      await tx
        .insert(storyMapRevealedEdges)
        .values(
          move.reveal.map((edge) => ({
            campaignId: scope.campaignId,
            fromKey: edge.fromKey,
            toKey: edge.toKey,
            sessionId: input.sessionId,
          })),
        )
        .onConflictDoNothing({
          target: [
            storyMapRevealedEdges.campaignId,
            storyMapRevealedEdges.fromKey,
            storyMapRevealedEdges.toKey,
          ],
        });
    }
  });
  return decision;
}

/** GET /v1/story-map/:campaignId payload (#1753). Shape posted on #1754 for the map screen. */
export interface StoryMapPayload {
  campaignId: string;
  /** False for a player-made campaign: the client shows no map. */
  available: boolean;
  currentPlaceKey: string | null;
  zones: Array<{ key: string; name: string }>;
  places: Array<{
    key: string;
    name: string;
    zoneKey: string | null;
    x: number;
    y: number;
    state: 'known' | 'visited';
    current: boolean;
    summary: string | null;
    imageUrl: string | null;
  }>;
  edges: Array<{ from: string; to: string; label: string | null }>;
}

/** The map for one campaign, owner only. Undefined = not found for this caller (404). */
export async function loadStoryMapPayload(
  campaignId: string,
  userId: string,
): Promise<StoryMapPayload | undefined> {
  const scope = await loadCampaignMapScope(campaignId, userId);
  if (scope === undefined) return undefined;
  const empty: StoryMapPayload = {
    campaignId,
    available: false,
    currentPlaceKey: null,
    zones: [],
    places: [],
    edges: [],
  };
  if (scope === null) return empty;
  const { places, edges } = await loadMap(scope.starterCampaignId);
  if (places.length === 0) return empty;
  const view = visibleMap(places, edges, await loadProgress(scope));

  // Names of zones and each place's art and summary come from the same bible chunks the
  // story map was built from; they are matched by generateAssetKey, the key the map uses.
  const chunks = await db
    .select({
      entityName: campaignChunks.entityName,
      summary: campaignChunks.summary,
      metadata: campaignChunks.metadata,
    })
    .from(campaignChunks)
    .where(
      and(
        eq(campaignChunks.campaignId, scope.starterCampaignId),
        eq(campaignChunks.chunkType, 'location'),
      ),
    );
  const zoneNames = new Map<string, string>();
  const placeInfo = new Map<string, { summary: string | null; imageUrl: string | null }>();
  for (const chunk of chunks) {
    if (!chunk.entityName) continue;
    const key = generateAssetKey(chunk.entityName);
    const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
    if (metadata.isZone === true) zoneNames.set(key, chunk.entityName);
    else
      placeInfo.set(key, {
        summary: chunk.summary ?? null,
        imageUrl: typeof metadata.image_url === 'string' ? metadata.image_url : null,
      });
  }
  const shownZones = [...new Set(view.places.map((place) => place.zoneKey))].filter(
    (key): key is string => key !== null,
  );

  return {
    campaignId,
    available: true,
    currentPlaceKey: view.currentPlaceKey,
    zones: shownZones.map((key) => ({ key, name: zoneNames.get(key) ?? key })),
    places: view.places.map((place) => ({
      key: place.placeKey,
      name: place.name,
      zoneKey: place.zoneKey,
      x: place.x,
      y: place.y,
      state: place.state,
      current: place.current,
      summary: placeInfo.get(place.placeKey)?.summary ?? null,
      imageUrl: placeInfo.get(place.placeKey)?.imageUrl ?? null,
    })),
    edges: view.edges.map((edge) => ({ from: edge.fromKey, to: edge.toKey, label: edge.label })),
  };
}
