import assert from 'node:assert/strict';

import { test } from 'bun:test';

import { chunkCampaignFiles } from './chunker.js';
import { replaceStoryMap } from './reingest-database.js';
import {
  SCENE_ENVIRONMENTS,
  SCENE_SIZES,
  buildStoryMap,
  fightEnvironmentFor,
  parseRoutesJson,
  proposeRoutes,
  routesFileJson,
  storyMapReportLine,
  type ChatCompletion,
} from './story-map.js';
import { generateAssetKey } from '../../../src/utils/asset-key.js';

import type { SupabaseClient } from '@supabase/supabase-js';

const LOCATIONS = `## 4. LOCATIONS
[TAG: LOCATIONS_MAIN]

### Zone 1: The Upper Reach
1. **The Rope Ledge**: A narrow ledge above the chasm.
2. **The Archive**: A dusty hall of shelves.

### Zone 2: The Deep
1. **The Sunken Gate**: A collapsed gate under black water.
2. **The Crypt**: Cramped tombs in a cave.
`;

const ROUTES = `## Routes

- The Rope Ledge -> The Sunken Gate (rope bridge)
- The Rope Ledge <-> The Archive
- The Archive <-> The Crypt (hidden: secret stair)
`;

const bible = (routes = ROUTES): string => `${LOCATIONS}\n${routes}\n## 5. QUEST ARCHITECTURE\n`;

const chunked = (text: string) => chunkCampaignFiles('abyssal-descent', { campaignBible: text });

test('parses the three route forms with their bible line numbers', () => {
  const { routes } = chunked(bible());
  assert.ok(routes);
  assert.deepEqual(
    routes.map(({ from, to, twoWay, hidden, label }) => ({ from, to, twoWay, hidden, label })),
    [
      {
        from: 'The Rope Ledge',
        to: 'The Sunken Gate',
        twoWay: false,
        hidden: false,
        label: 'rope bridge',
      },
      { from: 'The Rope Ledge', to: 'The Archive', twoWay: true, hidden: false, label: null },
      { from: 'The Archive', to: 'The Crypt', twoWay: true, hidden: true, label: 'secret stair' },
    ],
  );
  const lines = bible().split('\n');
  for (const route of routes) {
    const line = Number(route.source.replace('line ', ''));
    assert.ok(lines[line - 1].includes(route.from), `${route.source} points at the route line`);
  }
});

test('a one-way route is one edge; a two-way route is two; hidden is kept', () => {
  const { chunks, routes } = chunked(bible());
  const map = buildStoryMap('abyssal-descent', chunks, routes, null);
  assert.equal(map.routeCount, 3);
  assert.equal(map.routeSource, 'bible');
  const edges = map.edges.map(
    (edge) => `${edge.fromKey}>${edge.toKey}${edge.hidden ? ' hidden' : ''}`,
  );
  assert.deepEqual(edges.sort(), [
    'the-archive>the-crypt hidden',
    'the-archive>the-rope-ledge',
    'the-crypt>the-archive hidden',
    'the-rope-ledge>the-archive',
    'the-rope-ledge>the-sunken-gate',
  ]);
});

test('a route naming a place the parser did not find fails with its line number', () => {
  const text = bible('## Routes\n\n- The Rope Ledge -> The Lost Tower (stairs)\n');
  const { chunks, routes } = chunked(text);
  const line = text.split('\n').findIndex((row) => row.includes('Lost Tower')) + 1;
  assert.throws(
    () => buildStoryMap('abyssal-descent', chunks, routes, null),
    new RegExp(`line ${line} names "The Lost Tower"`),
  );
});

test('a line in the Routes section that is not a route fails with its line number', () => {
  const text = bible('## Routes\n\n- The Rope Ledge to The Archive\n');
  const line = text.split('\n').findIndex((row) => row.includes('to The Archive')) + 1;
  assert.throws(() => chunked(text), new RegExp(`Routes line ${line} is not a route`));
});

test('no Routes section: an approved routes.json is used; with neither, places and no edges', () => {
  const { chunks, routes } = chunked(bible(''));
  assert.equal(routes, null);

  const approved = parseRoutesJson(
    JSON.stringify([{ from: 'The Archive', to: 'The Crypt', hidden: true, label: 'secret stair' }]),
  );
  const fromFile = buildStoryMap('abyssal-descent', chunks, null, approved);
  assert.equal(fromFile.routeSource, 'routes.json');
  assert.equal(fromFile.edges.length, 2, 'routes.json routes are two-way unless twoWay is false');

  const bare = buildStoryMap('abyssal-descent', chunks, null, null);
  assert.equal(bare.routeSource, 'none');
  assert.equal(bare.places.length, 4);
  assert.equal(bare.edges.length, 0);
  assert.match(storyMapReportLine(bare), /4 places, 2 zones, no routes/);
});

test('place keys are the generateAssetKey of the location chunk name', () => {
  const { chunks, routes } = chunked(bible());
  const map = buildStoryMap('abyssal-descent', chunks, routes, null);
  const chunkKeys = chunks
    .filter((chunk) => chunk.chunkType === 'location' && chunk.metadata.isZone !== true)
    .map((chunk) => generateAssetKey(chunk.entityName!));
  assert.deepEqual(
    map.places.map((place) => place.placeKey),
    chunkKeys,
  );
  assert.deepEqual(
    map.places.map((place) => place.zoneKey),
    ['the-upper-reach', 'the-upper-reach', 'the-deep', 'the-deep'],
  );
});

test('the layout is stable, inside 0..1, and keeps each zone together', () => {
  const first = chunked(bible());
  const second = chunked(bible());
  const a = buildStoryMap('abyssal-descent', first.chunks, first.routes, null);
  const b = buildStoryMap('abyssal-descent', second.chunks, second.routes, null);
  assert.deepEqual(a.places, b.places);
  for (const place of a.places) {
    assert.ok(place.x > 0 && place.x < 1 && place.y > 0 && place.y < 1, place.placeKey);
  }
  const upper = a.places.filter((place) => place.zoneKey === 'the-upper-reach');
  const deep = a.places.filter((place) => place.zoneKey === 'the-deep');
  assert.ok(
    Math.max(...upper.map((place) => place.x)) < Math.min(...deep.map((place) => place.x)),
    'zone 1 sits left of zone 2',
  );
});

test('every fight recipe is legal and the seed depends only on campaign and place', () => {
  const { chunks, routes } = chunked(bible());
  const map = buildStoryMap('abyssal-descent', chunks, routes, null);
  for (const place of map.places) {
    assert.ok(SCENE_ENVIRONMENTS.includes(place.fightEnv), place.fightEnv);
    assert.ok(SCENE_SIZES.includes(place.fightSize), place.fightSize);
    assert.ok(
      Number.isInteger(place.fightSeed) && place.fightSeed > 0 && place.fightSeed < 2 ** 31,
    );
  }
  const byKey = Object.fromEntries(map.places.map((place) => [place.placeKey, place]));
  assert.equal(byKey['the-crypt'].fightEnv, 'cave');
  assert.equal(byKey['the-crypt'].fightSize, 'small');
  assert.equal(byKey['the-sunken-gate'].fightEnv, 'road');
  assert.equal(byKey['the-archive'].fightEnv, 'tavern');
  const other = buildStoryMap('another-campaign', chunks, routes, null);
  assert.notEqual(other.places[0].fightSeed, map.places[0].fightSeed);
  assert.equal(fightEnvironmentFor('The Vault', 'A plain stone room.'), 'dungeon_room');
});

test('--propose-routes makes one model call, keeps only known places, and prices it', async () => {
  const calls: Array<{ model: string; user: string }> = [];
  const stub: ChatCompletion = async ({ model, user }) => {
    calls.push({ model, user });
    return {
      text:
        '```json\n[{"from":"The Archive","to":"The Crypt","twoWay":true,"hidden":false,"label":"stair"},' +
        '{"from":"The Archive","to":"Nowhere","twoWay":true,"hidden":false,"label":null}]\n```',
      inputTokens: 15_000,
      outputTokens: 3_000,
    };
  };
  const result = await proposeRoutes(
    bible(''),
    ['The Archive', 'The Crypt'],
    'google/gemini-3.1-flash-lite',
    stub,
    { input: 0.25, output: 1.5 },
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0].user, /- The Archive\n- The Crypt/);
  assert.deepEqual(
    result.routes.map((route) => [route.from, route.to]),
    [['The Archive', 'The Crypt']],
  );
  assert.equal(result.inputTokens, 15_000);
  assert.equal(result.outputTokens, 3_000);
  assert.ok(Math.abs((result.costUsd ?? 0) - 0.00825) < 1e-9);
  assert.deepEqual(
    parseRoutesJson(routesFileJson(result.routes)).map(({ from, to, label }) => ({
      from,
      to,
      label,
    })),
    [{ from: 'The Archive', to: 'The Crypt', label: 'stair' }],
    'routes.proposed.json reads back in the routes.json shape',
  );
});

/** A stateful stand-in for the two story map tables, enforcing their unique keys. */
function storyMapTables(): {
  client: SupabaseClient;
  places: Map<string, Record<string, unknown>>;
  edges: Map<string, Record<string, unknown>>;
} {
  const places = new Map<string, Record<string, unknown>>();
  const edges = new Map<string, Record<string, unknown>>();
  const placeKey = (row: Record<string, unknown>) => `${row.campaign_id}|${row.place_key}`;
  const edgeKey = (row: Record<string, unknown>) =>
    `${row.campaign_id}|${row.from_key}|${row.to_key}`;
  const client = {
    from: (table: string) => {
      const rows = table === 'story_map_places' ? places : edges;
      return {
        select: () => ({
          eq: async (_column: string, campaign: string) => ({
            data: [...rows.values()].filter((row) => row.campaign_id === campaign),
            error: null,
          }),
        }),
        upsert: async (
          payload: Array<Record<string, unknown>>,
          options: { onConflict: string },
        ) => {
          assert.equal(options.onConflict, 'campaign_id,place_key');
          for (const row of payload) places.set(placeKey(row), row);
          return { error: null };
        },
        insert: async (payload: Array<Record<string, unknown>>) => {
          for (const row of payload) {
            if (edges.has(edgeKey(row))) return { error: { message: 'duplicate key' } };
            edges.set(edgeKey(row), row);
          }
          return { error: null };
        },
        delete: () => {
          const filters: { campaign?: string; keys?: string[] } = {};
          const run = () => {
            for (const [key, row] of rows) {
              if (row.campaign_id !== filters.campaign) continue;
              if (filters.keys && !filters.keys.includes(row.place_key as string)) continue;
              rows.delete(key);
            }
            return { error: null };
          };
          const builder = {
            eq: (_column: string, campaign: string) => {
              filters.campaign = campaign;
              return builder;
            },
            in: (_column: string, keys: string[]) => {
              filters.keys = keys;
              return builder;
            },
            then: (resolve: (value: { error: null }) => void) => resolve(run()),
          };
          return builder;
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, places, edges };
}

test('re-ingest updates rows in place and reports a place key that went away', async () => {
  const { chunks, routes } = chunked(bible());
  const map = buildStoryMap('abyssal-descent', chunks, routes, null);
  const { client, places, edges } = storyMapTables();

  const first = await replaceStoryMap(client, map);
  assert.equal(first.placesWritten, 4);
  assert.equal(first.edgesWritten, 5);
  assert.deepEqual(first.removedKeys, []);
  const second = await replaceStoryMap(client, map);
  assert.deepEqual(second.addedKeys, []);
  assert.equal(places.size, 4, 'no duplicate places');
  assert.equal(edges.size, 5, 'no duplicate routes');

  const renamed = bible().replace('The Crypt', 'The Ossuary').replace('The Crypt', 'The Ossuary');
  const next = chunked(renamed);
  const third = await replaceStoryMap(
    client,
    buildStoryMap('abyssal-descent', next.chunks, next.routes, null),
  );
  assert.deepEqual(third.removedKeys, ['the-crypt']);
  assert.deepEqual(third.addedKeys, ['the-ossuary']);
  assert.equal(places.size, 4);
  assert.ok(!places.has('abyssal-descent|the-crypt'));
});
