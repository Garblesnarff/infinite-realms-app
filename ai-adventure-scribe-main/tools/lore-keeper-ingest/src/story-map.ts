/**
 * Story map (#1742, build step 1 #1752): the region map of one starter campaign.
 *
 * Places come from the chunker's `location` chunks; zones are the `isZone` location chunks in
 * bible order. Routes come from the bible's `## Routes` section, or, when a bible has none, from
 * an approved `routes.json` beside it. This module turns them into rows for `story_map_places`
 * and `story_map_edges`: a stable layout (x/y in 0..1), and a fight recipe per place.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { generateAssetKey } from '../../../src/utils/asset-key.js';

import type { CampaignChunk, StoryMapRoute } from './types.js';
import type { SceneEnvironment, SceneSize } from '../../../server-bun/src/tactical/types.js';

export interface StoryMapPlace {
  placeKey: string;
  name: string;
  zoneKey: string | null;
  x: number;
  y: number;
  fightEnv: SceneEnvironment;
  fightSize: SceneSize;
  fightSeed: number;
}

export interface StoryMapEdge {
  fromKey: string;
  toKey: string;
  label: string | null;
  hidden: boolean;
}

export interface StoryMap {
  campaignId: string;
  places: StoryMapPlace[];
  edges: StoryMapEdge[];
  zoneCount: number;
  /** Number of route lines (a two-way route counts once). */
  routeCount: number;
  routeSource: 'bible' | 'routes.json' | 'none';
}

export const SCENE_ENVIRONMENTS: readonly SceneEnvironment[] = [
  'dungeon_room',
  'cave',
  'tavern',
  'forest_clearing',
  'road',
  'ruins',
  'ship_deck',
  'open_field',
  'corridor',
];
export const SCENE_SIZES: readonly SceneSize[] = ['small', 'medium', 'large'];

/**
 * `routes.json` beside the bible: an array of `{ from, to, twoWay?, hidden?, label? }`, the
 * same fields a parsed Routes line has. Ingest never reads `routes.proposed.json`.
 */
export { parseBibleRoutes } from './chunker.js';

export function parseRoutesJson(json: string): StoryMapRoute[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('routes.json must be an array of routes');
  return value.map((entry: unknown, index): StoryMapRoute => {
    const route = entry as Record<string, unknown>;
    if (typeof route?.from !== 'string' || typeof route?.to !== 'string') {
      throw new Error(`routes.json entry ${index + 1} needs string "from" and "to"`);
    }
    return {
      from: route.from.trim(),
      to: route.to.trim(),
      twoWay: route.twoWay !== false,
      hidden: route.hidden === true,
      label: typeof route.label === 'string' && route.label.trim() ? route.label.trim() : null,
      source: `routes.json entry ${index + 1}`,
    };
  });
}

export function readApprovedRoutesFile(campaignPath: string): StoryMapRoute[] | null {
  const path = join(campaignPath, 'routes.json');
  if (!existsSync(path)) return null;
  return parseRoutesJson(readFileSync(path, 'utf-8'));
}

/** Places (not zones) and zones, in bible order, from the chunker's location chunks. */
export function placesAndZones(chunks: CampaignChunk[]): {
  places: Array<{ name: string; zone: string | null; text: string }>;
  zones: string[];
} {
  const zones: string[] = [];
  const places: Array<{ name: string; zone: string | null; text: string }> = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.chunkType !== 'location' || !chunk.entityName) continue;
    if (chunk.metadata?.isZone === true) {
      zones.push(chunk.entityName);
      continue;
    }
    const key = generateAssetKey(chunk.entityName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    places.push({ name: chunk.entityName, zone: chunk.parentEntity ?? null, text: chunk.content });
  }
  return { places, zones };
}

/** 32-bit FNV-1a, kept below 2^31 so it fits a Postgres integer. */
export function fightSeedFor(placeKey: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < placeKey.length; index += 1) {
    hash ^= placeKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 1 || 1;
}

/** First match wins; the place name counts before its description. */
const ENVIRONMENT_WORDS: Array<[SceneEnvironment, RegExp]> = [
  ['ship_deck', /\b(ship|deck|boat|brig|galleon|dock|pier|wharf)s?\b/i],
  ['tavern', /\b(tavern|inn|pub|kitchen|dining|banquet|feast|hall|bakery|pantry)s?\b/i],
  ['cave', /\b(cave|cavern|grotto|burrow|abyss|chasm|mine|tunnel)s?\b/i],
  ['corridor', /\b(corridor|hallway|passage|stair|stairway|gallery)s?\b/i],
  ['ruins', /\b(ruin|ruined|ruins|crumbling|collapsed)\b/i],
  [
    'forest_clearing',
    /\b(forest|wood|woods|grove|garden|glade|clearing|bower|orchard|jungle)s?\b/i,
  ],
  ['road', /\b(road|street|market|bridge|path|square|crossing|gate)s?\b/i],
  ['open_field', /\b(field|meadow|plains|shore|beach|ocean|sea|desert|courtyard)s?\b/i],
];

export function fightEnvironmentFor(name: string, text: string): SceneEnvironment {
  for (const source of [name, text]) {
    for (const [environment, pattern] of ENVIRONMENT_WORDS) {
      if (pattern.test(source)) return environment;
    }
  }
  return 'dungeon_room';
}

export function fightSizeFor(name: string, text: string): SceneSize {
  const source = `${name} ${text}`;
  if (/\b(vast|huge|enormous|great|grand|sprawling|ocean|sea|plains)\b/i.test(source))
    return 'large';
  if (/\b(small|narrow|cramped|tiny|cell|closet|alcove)\b/i.test(source)) return 'small';
  return 'medium';
}

const MARGIN = 0.08;
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

/**
 * Zones become cells of a grid in bible order (left to right, then down); each zone's places
 * sit on a small grid inside its cell, in bible order. Places with no zone share one cell after
 * the zones. Pure: the same places and zones give the same coordinates.
 */
export function layoutPlaces(
  places: Array<{ key: string; zone: string | null }>,
  zones: string[],
): Map<string, { x: number; y: number }> {
  const groups: Array<{ zone: string | null; keys: string[] }> = zones.map((zone) => ({
    zone,
    keys: [],
  }));
  const loose: string[] = [];
  for (const place of places) {
    const group = place.zone == null ? undefined : groups.find((g) => g.zone === place.zone);
    if (group) group.keys.push(place.key);
    else loose.push(place.key);
  }
  if (loose.length > 0) groups.push({ zone: null, keys: loose });
  const filled = groups.filter((group) => group.keys.length > 0);

  const positions = new Map<string, { x: number; y: number }>();
  const columns = Math.max(1, Math.ceil(Math.sqrt(filled.length)));
  const rows = Math.max(1, Math.ceil(filled.length / columns));
  const cellWidth = (1 - 2 * MARGIN) / columns;
  const cellHeight = (1 - 2 * MARGIN) / rows;
  filled.forEach((group, groupIndex) => {
    const cellX = MARGIN + (groupIndex % columns) * cellWidth;
    const cellY = MARGIN + Math.floor(groupIndex / columns) * cellHeight;
    const innerColumns = Math.max(1, Math.ceil(Math.sqrt(group.keys.length)));
    const innerRows = Math.max(1, Math.ceil(group.keys.length / innerColumns));
    group.keys.forEach((key, index) => {
      const column = index % innerColumns;
      const row = Math.floor(index / innerColumns);
      positions.set(key, {
        x: round4(cellX + ((column + 0.5) / innerColumns) * cellWidth),
        y: round4(cellY + ((row + 0.5) / innerRows) * cellHeight),
      });
    });
  });
  return positions;
}

/**
 * Build the map rows for one campaign. A route that names a place the parser did not find
 * throws, naming where the route was written.
 */
export function buildStoryMap(
  campaignId: string,
  chunks: CampaignChunk[],
  bibleRoutes: StoryMapRoute[] | null,
  approvedRoutes: StoryMapRoute[] | null,
): StoryMap {
  const { places, zones } = placesAndZones(chunks);
  const keyed = places.map((place) => ({ ...place, key: generateAssetKey(place.name) }));
  const positions = layoutPlaces(
    keyed.map((place) => ({ key: place.key, zone: place.zone })),
    zones,
  );
  const zoneKeys = new Set(zones);

  const storyPlaces: StoryMapPlace[] = keyed.map((place) => {
    const position = positions.get(place.key) ?? { x: 0.5, y: 0.5 };
    return {
      placeKey: place.key,
      name: place.name,
      zoneKey: place.zone && zoneKeys.has(place.zone) ? generateAssetKey(place.zone) : null,
      x: position.x,
      y: position.y,
      fightEnv: fightEnvironmentFor(place.name, place.text),
      fightSize: fightSizeFor(place.name, place.text),
      fightSeed: fightSeedFor(`${campaignId}:${place.key}`),
    };
  });

  const routes = bibleRoutes ?? approvedRoutes ?? [];
  const routeSource = bibleRoutes ? 'bible' : approvedRoutes ? 'routes.json' : 'none';
  const known = new Set(storyPlaces.map((place) => place.placeKey));
  const edges = new Map<string, StoryMapEdge>();
  for (const route of routes) {
    const fromKey = generateAssetKey(route.from);
    const toKey = generateAssetKey(route.to);
    for (const [name, key] of [
      [route.from, fromKey],
      [route.to, toKey],
    ] as const) {
      if (!known.has(key)) {
        throw new Error(
          `${campaignId}: route at ${route.source} names "${name}", which is not a place the parser found`,
        );
      }
    }
    if (fromKey === toKey) {
      throw new Error(
        `${campaignId}: route at ${route.source} leads from "${route.from}" to itself`,
      );
    }
    const directions = route.twoWay
      ? [
          [fromKey, toKey],
          [toKey, fromKey],
        ]
      : [[fromKey, toKey]];
    for (const [a, b] of directions) {
      edges.set(`${a}\u0000${b}`, {
        fromKey: a,
        toKey: b,
        label: route.label,
        hidden: route.hidden,
      });
    }
  }

  return {
    campaignId,
    places: storyPlaces,
    edges: [...edges.values()],
    zoneCount: zones.length,
    routeCount: routes.length,
    routeSource,
  };
}

/** One line for the ingest report. */
export function storyMapReportLine(map: StoryMap): string {
  const routes =
    map.routeSource === 'none'
      ? 'no routes (no ## Routes section and no routes.json)'
      : `${map.routeCount} routes from ${map.routeSource}`;
  return `${map.campaignId}: story map ${map.places.length} places, ${map.zoneCount} zones, ${routes}`;
}

// ---------------------------------------------------------------------------------------------
// --propose-routes: one model call that drafts routes.proposed.json for a person to check.
// ---------------------------------------------------------------------------------------------

export interface ProposeRoutesResult {
  routes: StoryMapRoute[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

export type ChatCompletion = (request: { model: string; system: string; user: string }) => Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The provider's own cost for the call, when it reports one. */
  costUsd?: number;
}>;

export function proposeRoutesPrompt(
  bible: string,
  placeNames: string[],
): { system: string; user: string } {
  return {
    system:
      'You read a tabletop campaign bible and list the routes between its places. ' +
      'Use only the place names given, spelled exactly. Add a route only when the bible text ' +
      'shows the hero can move between the two places (a door, road, stair, passage, or a quest ' +
      'beat that moves them). Mark hidden only when the bible says it must be found. ' +
      'Answer with JSON only: an array of {"from","to","twoWay","hidden","label"}.',
    user: `Places:\n${placeNames.map((name) => `- ${name}`).join('\n')}\n\nBible:\n${bible}`,
  };
}

/** Pull the JSON array out of a model reply that may wrap it in a code fence. */
export function routesFromModelText(text: string): StoryMapRoute[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end < start) throw new Error('The model reply has no JSON array of routes');
  return parseRoutesJson(text.slice(start, end + 1));
}

export async function proposeRoutes(
  bible: string,
  placeNames: string[],
  model: string,
  complete: ChatCompletion,
  pricePerMillion: { input: number; output: number } | undefined,
): Promise<ProposeRoutesResult> {
  const prompt = proposeRoutesPrompt(bible, placeNames);
  const reply = await complete({ model, ...prompt });
  const known = new Set(placeNames.map((name) => generateAssetKey(name)));
  const routes = routesFromModelText(reply.text).filter(
    (route) =>
      known.has(generateAssetKey(route.from)) &&
      known.has(generateAssetKey(route.to)) &&
      generateAssetKey(route.from) !== generateAssetKey(route.to),
  );
  const costUsd =
    reply.costUsd ??
    (pricePerMillion
      ? (reply.inputTokens * pricePerMillion.input + reply.outputTokens * pricePerMillion.output) /
        1_000_000
      : null);
  return {
    routes,
    model,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    costUsd,
  };
}

/** The shape written to routes.proposed.json: the same shape routes.json is read in. */
export function routesFileJson(routes: StoryMapRoute[]): string {
  return `${JSON.stringify(
    routes.map(({ from, to, twoWay, hidden, label }) => ({ from, to, twoWay, hidden, label })),
    null,
    2,
  )}\n`;
}
