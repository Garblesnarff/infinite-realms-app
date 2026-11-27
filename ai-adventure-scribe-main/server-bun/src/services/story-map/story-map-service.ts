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
  currentPlaceKey,
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
  /** The owner: every story_map_progress / story_map_revealed_edges query filters by it. */
  userId: string;
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
  return {
    campaignId: row.campaignId,
    starterCampaignId: row.starterCampaignId,
    sessionId,
    userId,
  };
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
  return { campaignId, starterCampaignId: session.starterCampaignId, sessionId: null, userId };
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

/** The player's progress. RLS is off (AGENTS §4): both reads join campaigns on the owner. */
async function loadProgress(scope: MapScope): Promise<MapProgress> {
  const rows = await db
    .select({
      placeKey: storyMapProgress.placeKey,
      state: storyMapProgress.state,
      visitedAt: storyMapProgress.visitedAt,
    })
    .from(storyMapProgress)
    .innerJoin(campaigns, eq(campaigns.id, storyMapProgress.campaignId))
    .where(
      and(eq(storyMapProgress.campaignId, scope.campaignId), eq(campaigns.userId, scope.userId)),
    );
  const revealed = await db
    .select({ fromKey: storyMapRevealedEdges.fromKey, toKey: storyMapRevealedEdges.toKey })
    .from(storyMapRevealedEdges)
    .innerJoin(campaigns, eq(campaigns.id, storyMapRevealedEdges.campaignId))
    .where(
      and(
        eq(storyMapRevealedEdges.campaignId, scope.campaignId),
        eq(campaigns.userId, scope.userId),
      ),
    );
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

  const move = planMove(decision.placeKey, edges, progress, places);
  // RLS is off (AGENTS §4): each write is INSERT ... SELECT FROM campaigns filtered on the
  // owner, so a row can only land on a campaign this user owns, whatever the scope said.
  const owned = sql`FROM campaigns c WHERE c.id = ${scope.campaignId}::uuid AND c.user_id = ${scope.userId}`;
  await db.transaction(async (tx) => {
    const visited = await tx.execute(sql`
      INSERT INTO story_map_progress (campaign_id, place_key, state, first_session_id, visited_at)
      SELECT c.id, ${move.visit}, 'visited', ${input.sessionId}::uuid, now() ${owned}
      ON CONFLICT (campaign_id, place_key) DO UPDATE SET state = 'visited', visited_at = now()
      RETURNING place_key`);
    if (visited.length === 0) throw new Error("story map write: campaign is not the caller's");
    for (const placeKey of move.know) {
      await tx.execute(sql`
        INSERT INTO story_map_progress (campaign_id, place_key, state, first_session_id)
        SELECT c.id, ${placeKey}, 'known', ${input.sessionId}::uuid ${owned}
        ON CONFLICT (campaign_id, place_key) DO NOTHING`);
    }
    for (const edge of move.reveal) {
      await tx.execute(sql`
        INSERT INTO story_map_revealed_edges (campaign_id, from_key, to_key, session_id)
        SELECT c.id, ${edge.fromKey}, ${edge.toKey}, ${input.sessionId}::uuid ${owned}
        ON CONFLICT (campaign_id, from_key, to_key) DO NOTHING`);
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

/** A place's fight-board recipe (#1755): the scene_spec fields a fight there must use. */
export interface PlaceFightRecipe {
  placeKey: string;
  environment: string;
  size: string;
  seed: number;
}

/**
 * The recipe of the session campaign's current place, or null when there is none: no map
 * (player-made campaign, no campaign_id), or no visited place yet.
 */
export async function loadPlaceFightRecipe(
  sessionId: string,
  userId: string,
): Promise<PlaceFightRecipe | null> {
  const scope = await loadSessionMapScope(sessionId, userId);
  if (!scope) return null;
  const placeKey = currentPlaceKey(await loadProgress(scope));
  if (!placeKey) return null;
  const [row] = await db
    .select({
      environment: storyMapPlaces.fightEnv,
      size: storyMapPlaces.fightSize,
      seed: storyMapPlaces.fightSeed,
    })
    .from(storyMapPlaces)
    .where(
      and(
        eq(storyMapPlaces.campaignId, scope.starterCampaignId),
        eq(storyMapPlaces.placeKey, placeKey),
      ),
    )
    .limit(1);
  return row ? { placeKey, ...row } : null;
}
