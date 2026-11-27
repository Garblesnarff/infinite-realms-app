# Story maps: a map for the story, not only fights

**Issue:** #1742 (P1)
**Status:** design spike; no production behavior changes
**Review constraint:** Draft only — do not merge
**Decision (Rob, 11-25, on #1742):** option B, the drawn region map, for launch.

Rob, 11-24: "There is no map in the story currently. We need to figure out how
we would generate those for the worlds." This doc says what a story map is for
Infinite Realms, compares four ways to make one, and specifies the launch
version Rob picked. Section 11 lists the five build issues.

Paths are under `ai-adventure-scribe-main/` unless they start with `docs/` or
`ops/`.

## Bottom line

Launch with a **region map made once per starter campaign at ingest**. Each
place and each route comes from the bible: places from the parser that exists
today, routes from new `Routes:` lines in the bible, or, where a bible has none,
from one model call whose output a person checks once. A script lays the graph
out and stores x/y. The client draws it as SVG in the Table look, with a text
list of the same places beside it. The player sees where they are, the places
they found and the routes they know. **Travel here** on a known neighbour puts
"I travel to X" in the composer. Each place stores a fight-board recipe
(`environment`, `size`, `seed`), so a fight there gets the same board on every
visit. Discovery is stored per campaign, so it carries over to the next
session. Player-made campaigns show no map at launch.

Cost (arithmetic in §3): about **$0.003–0.008 of model spend per campaign**
once, plus a person's check of the routes; **about $0.003–0.007 per 100 DM
turns** for the new place field. No new client library.

## 1. What is on main today (read at `4417bba`, rechecked at `d35bf8c`)

| Area | What exists | File |
|---|---|---|
| Fight grid | Server-authoritative grid, 1 cell = 5 ft, terrain + cover + sight per cell. | `server-bun/src/tactical/types.ts` |
| Fight board generator | `generateMap(spec)` builds a board from `environment` (9 values: `dungeon_room`, `cave`, `tavern`, `forest_clearing`, `road`, `ruins`, `ship_deck`, `open_field`, `corridor`), `size` (10×10, 14×12, 20×16) and `seed`. Deterministic: same spec + seed = same board. Uses `rot-js` (server only). | `server-bun/src/tactical/generator.ts:8,114` |
| Fight storage | `tactical_maps` row per session, `state` jsonb, one active per session. No link to a place. | `db/schema/tactical-maps.ts` |
| DM hook | The DM sends `scene_spec` when a fight starts and `map_actions` during it; the sanitizer rejects an unknown `environment`. | `server-bun/src/services/dm/dm-response-schema.ts:182`, `server-bun/src/services/combat/scene-spec-sanitizer.ts:48` |
| Fight canvas | 2D canvas, DPR-aware, pointer + two-finger pinch, height `min(52vh,520px)`. On a narrow screen a Map button opens it in a sheet that stops above the dock (roll tray + composer). | `src/features/game-session/components/tactical/TacticalMapCanvas.tsx:110,272,323`, `src/features/game-session/components/game/game-content/GameMainContent.tsx:342-351,808-839` |
| Bible places | Ingest makes one `location` chunk per place. Two bible shapes: `### Zone N: Name` + numbered places (zone kept as `parentEntity` and `metadata.zone`), or bullet places with no zone. | `tools/lore-keeper-ingest/src/chunker.ts:451-530` |
| Place art | `campaign_chunks.metadata.image_url` per place, loaded by `useCampaignAssets`; re-ingest keeps it. | `src/hooks/use-campaign-assets.ts`, `scripts/reingest-starter-campaigns.ts` |
| Routes between places | **None.** The chunker keeps zone → place only (`chunker.ts:459-530`). No "leads to" or "connects" field is parsed. NPC rows carry a free-text `Location`. | `chunker.ts:247,283` |
| Old `locations` table | Has `connected_locations` and `map_url` columns, keyed to user `campaigns.id` (uuid). Only a read mapper uses them; nothing in the repo writes them. | `db/schema/world.ts:59-84`, `server-bun/src/routes/v1/world-builder.ts:66-68` |
| "Where am I" | The Table plaque shows `EXPLORING` + a place name. The name is the free text `context.location` of the newest message that has one, found on the client. It is not an id. The DM reply schema has no place field. | `src/features/game-session/components/game/game-content/GameMainContent.tsx:354`, `src/features/game-session/components/game/overhaul/SceneHeader.tsx` |
| Sessions and campaigns | A starter playthrough is a user `campaigns` row (`user_id`) with one `game_sessions` row per session (`campaign_id`, `starter_campaign_id`). A session can have `campaign_id = null`. | `db/schema/game.ts:290-312`, `server-bun/src/services/session-service.ts:366-450` |

I could not read the four starter bibles (the content repo is private and was
not attached to this session). Place and route counts per campaign are
therefore assumptions, marked where used.

## 2. What a story map means here

| Kind | Scale | Player does | Launch? |
|---|---|---|---|
| **Region map** | Zones and places of one campaign, routes between them. Not to scale. | See where they are; see places found and routes known; travel to a neighbour; open a place card (art + summary). | **Yes** |
| **Location map** | Rooms of a dungeon, streets of a town. 5-ft grid or near it. | Walk room to room; see doors; a fight starts on the same layout. | After launch |
| **Fight board** | One encounter area, 5-ft cells. | Exists today. | Exists; gains a fixed recipe per place |

A solo text RPG is driven by prose. The map supports the prose; it does not
replace it. The map never moves the character by itself: **Travel here** puts a
line in the composer, the player sends it, and the DM reply moves the "you are
here" marker.

## 3. Generation options and costs

### Price basis

| Model | Where it is used | Input $/1M | Output $/1M | Source |
|---|---|---|---|---|
| `google/gemini-3.1-flash-lite` | Code default DM and fallback (`server-bun/src/services/llm-model-config.ts:5`) | 0.25 | 1.50 | OpenRouter model page (see Sources). `model-pricing.ts` has no row for this id; its `-preview` row has the same rates. |
| Claude Haiku 5.5 | DM model as approved | 0.10 | 0.50 | Anthropic price list (prompts up to 100K tokens). `model-pricing.ts` has no row for it either (see Friction). |
| `google/gemini-3.1-flash-image` | Scene art (`server-bun/src/routes/v1/images.ts:227`) | 0.50 | 3.00 text; **60.00 image output** | `server-bun/src/services/model-pricing.ts:14` |

Assumptions (not measured, because the bibles were not readable here):
**25 places and 40 routes per campaign; 15,000 input tokens** for the parts
of the bible the extractor reads (location section, NPC table, quest beats);
**3,000 output tokens** for the graph JSON; **1,300 image tokens** per 1K
image (Google's published figure for its flash-image models); **100 DM turns
per session** for per-session numbers.

### Where the routes (graph edges) come from

The parser has places and zones but no edges. Two sources, in this order:

1. **Authored `Routes:` lines in the bible (preferred).** One line per route
   under a new `## Routes` heading (or a `[TAG: ROUTES]` block, the bibles'
   existing tag style), for example
   `- The Rope Ledge -> The Sunken Gate (rope bridge)` and
   `- The Archive <-> The Crypt (hidden: secret stair)`. The chunker parses
   them into edges; a name that does not match a parsed place fails the ingest
   with the line number. **Model cost $0.** People cost: writing ~40 lines per
   campaign.
2. **One model call per campaign, then a person's check (fallback when a bible
   has no `Routes:` section).** The ingest tool sends the location section,
   the NPC table and the quest beats and asks for edges only between the
   parsed place names. It writes `routes.proposed.json` next to the bible. A
   person (Rob or the content author) reads it, fixes it and renames it to
   `routes.json`; ingest reads only the approved file. The approved file can
   also be pasted back into the bible as `Routes:` lines, so (1) becomes the
   one source over time.

   - Flash Lite: 15,000 × $0.25/1M = $0.00375; 3,000 × $1.50/1M = $0.00450;
     **total $0.00825**. Three tries: $0.025.
   - Haiku 5.5: 15,000 × $0.10/1M = $0.00150; 3,000 × $0.50/1M = $0.00150;
     **total $0.00300**. Three tries: $0.009.
   - People cost: the check, estimated 15–30 minutes per campaign.

The layout (x/y per place) and the fight recipe per place (`environment` from
the place text, `size`, `seed` from a hash of the place key) are computed by
code at the same ingest step. Model cost $0.

### The four options

| Option | How it works | Cost per campaign | Cost per session (100 turns) | Quality | Build size |
|---|---|---|---|---|---|
| **(a) Authored graph at ingest** | Places from the parser; routes as above; stored once. | $0 (routes lines) to $0.003–0.008 (model + check) | Place field only (below) | High: every route is checked once. | M |
| **(b) Procedural layout, fixed style** (**picked**) | The graph from (a). Zones are labelled areas in story order; places are pins in them; routes are lines. x/y computed once at ingest; client draws SVG. | Same as (a) | Same as (a) | Clean, readable, one look in every campaign. Not painted. | M on top of (a). No client library. |
| **(c) Painted map art + hotspots** | One image call per campaign for a region painting; places placed on it by hand or by a vision pass. | Region: 1,300 × $60/1M = $0.078 per image; 3–5 tries = **$0.23–0.39**. Location art for 25 places: 25 × $0.078 = **$1.95** for one try each. | $0 | Best looking when it works. The image model does not put places where the graph says and does not spell labels reliably. Art goes stale when the bible changes. | L |
| **(d) DM at runtime** | The DM emits a layout the first time the player enters a place; stored after. | $0 | ~300 extra output tokens per new place. Haiku: 300 × $0.50/1M = $0.00015; Flash Lite: 300 × $1.50/1M = $0.00045. At 5 new places a session: **$0.0008–0.0023**. | Lowest. A new free-form output the sanitizer must police; places drift unless stored. | M |

### Per-session cost of the picked option

The DM reply gets one optional field, `place` (§6), and the prompt gets the
list of place keys the player knows. Assume 25 keys × 8 tokens = **200 input
tokens per turn** and **10 output tokens** when `place` is set (assume every
turn, the upper bound).

- Haiku 5.5: 200 × $0.10/1M + 10 × $0.50/1M = $0.000020 + $0.000005 =
  $0.000025 per turn → **$0.0025 per 100 turns**.
- Flash Lite: 200 × $0.25/1M + 10 × $1.50/1M = $0.000050 + $0.000015 =
  $0.000065 per turn → **$0.0065 per 100 turns**.

Drawing the map is client SVG: $0. So the earlier draft's "$0 per session"
was wrong by these amounts.

## 4. Data shape

Places, routes and recipes are per starter campaign, written at ingest:

```
story_map_places
  campaign_id      text   -> starter_campaigns.id
  place_key        text   generateAssetKey(entity_name), matches campaign_chunks
  name             text
  zone_key         text   null when the bible has no zones
  x, y             real   0..1
  fight_env        text   one of the 9 SceneEnvironment values
  fight_size       text   small | medium | large
  fight_seed       int
  unique (campaign_id, place_key)

story_map_edges
  campaign_id, from_key, to_key, label text, hidden bool
  unique (campaign_id, from_key, to_key)
```

### How discovery persists across sessions

Discovery belongs to the player's **campaign**, not the session, because each
new session of the same playthrough is a new `game_sessions` row with the same
`campaign_id` (`session-service.ts:366-410`).

```
story_map_progress
  campaign_id        uuid  -> campaigns.id (the player's own row, has user_id)
  place_key          text
  state              text  'known' | 'visited'
  first_session_id   uuid  -> game_sessions.id (the session that found it)
  visited_at         timestamptz  null until visited
  unique (campaign_id, place_key)

story_map_revealed_edges
  campaign_id uuid, from_key text, to_key text, session_id uuid
  unique (campaign_id, from_key, to_key)
```

- **Current place** = the `visited` row with the newest `visited_at`. A new
  session opens with the marker where the last session ended; no extra column.
- **Known routes** = every edge with `hidden = false` whose ends are both known
  or visited, plus the rows in `story_map_revealed_edges`.
- **Owner filter.** RLS is off (AGENTS §4): every read and write joins
  `campaigns` and filters `campaigns.user_id`. `story_map_progress` has no
  `user_id` of its own.
- **Sessions with `campaign_id = null`** get no map and write no progress.
- **New playthrough** of the same starter campaign is a new `campaigns` row,
  so it starts with an empty map, as a new hero should (matches #136's
  "new hero starts from the beginning").
- **Re-ingest** keeps `place_key` stable (it is `generateAssetKey(name)`); a
  renamed place drops out of progress. The ingest report lists renamed keys.

One migration tree owns these tables: `db/migrations/` (AGENTS §7), with the
matching `db/schema/story-map.ts` in the same commit (`docs/TESTING-REALISM.md`
schema rule).

## 5. Player-made campaigns at launch

Player-made campaigns have no bible and no `starter_campaign_id`, so they have
no place graph. **At launch they show no map**: no Map button, no place list.
The plaque keeps today's behavior (the free-text `context.location`). The DM
prompt for them does not get the place list, and a `place` value in their DM
replies is ignored. Maps for them wait until after launch (option d writing
into the same tables).

## 6. The new `place` field on the DM reply

**Shape.** One optional string, `place`, on the **narrative** phase only
(travel happens outside fights). The prompt lists the known and neighbouring
place keys. The server accepts the value only if it is a `place_key` of the
session's starter campaign **and** is the current place, a known neighbour, or
a place the DM names for the first time with `state = known` (a neighbour of a
visited place); anything else is dropped and logged, not an error. The client
never sends it.

**The opening (strategist decision, 11-26, #1762).** Before the first visit the
campaign has no visited place, so there is no current place and no neighbour to
check against. In that state the server accepts any `place_key` of the
session's starter map: that is the place the opening scene puts the hero
(`story-map-rules.ts`, the `opening` branch of `decidePlace`). To let the DM
choose it, the `<story_map>` block lists every place of the map until the first
visit, and only the known places and their routes after it. From the first
visit on, the rules above apply.

**Same zone (strategist decision, 11-27, #1762).** Places in the same zone are
neighbours without a route line. The first real routes (#1757) showed why: one
bible has 40 places and 7 routes, so 32 places had no route at all. Routes are
for paths between zones and for hidden paths. So a place is a neighbour of a
visited place when a route leads to it **or** it is in the same zone (both
`zone_key` set and equal). The accept rule in `decidePlace` uses that, the
`<story_map>` block lists same-zone places among the routes onward, and a
visit makes same-zone places known. A place with no zone (a bible without
zones) has no same-zone neighbours; only routes reach it.

**Budget.** Narrative optionals go 20 → 21. The strict cap is 24
(`dm-response-schema-budget.test.ts:59-139`), so it fits.

**Files and tests that change:**

| File | Change |
|---|---|
| `server-bun/src/services/dm/dm-response-schema.ts` | Add `place` to the narrative phase and to the live schema. |
| `server-bun/src/services/dm/__tests__/dm-response-schema-budget.test.ts` | Ratchet: `narrative.optionals` 20 → 21 (line 137); live-schema optionals and bytes re-measured; header comment records the new baseline. |
| `server-bun/src/services/dm/__tests__/fixtures/main-dm-response-schema.json` | Re-recorded. Byte-compared by `dm-response-schema-budget.test.ts:418`, `dm-response-phase.test.ts:667` and `routes/v1/__tests__/llm-generate-schema-server-side.test.ts:149-182`. |
| `server-bun/src/services/dm/__tests__/dm-response-schema.test.ts`, `dm-response-phase.test.ts` | New cases: `place` present on narrative, absent on combat and tactical. |
| `server-bun/src/services/dm/__tests__/dm-response-schema-anthropic.test.ts` | The Haiku forced-tool path carries `place`; a `null` or `"null"` value is treated as absent (the #783 rules). |
| `server-bun/src/services/__tests__/llm-provider-gemini-full-schema.test.ts`, `llm-provider-strict-shadow.test.ts`, `llm-provider-phase-shadow.test.ts` | Re-run; update only if they pin the schema text. |
| New: `server-bun/src/services/story-map/__tests__/place-validation.test.ts` | Unknown key dropped; owner filter; `campaign_id = null` writes nothing. |

**Live probe: yes, needed.** The change alters the schema sent as
`response_format` (Flash Lite) and as the forced tool (Haiku 5.5). Unit tests
cannot show that the providers accept it. Before the PR gets a PASS, the
Hetzner ops session (the only place with the provider keys) posts one real
narrative turn with the new schema through `/v1/llm/generate` with both
`OPENROUTER_TEXT_MODEL` values, as `docs/TESTING-REALISM.md` requires, and
pastes `parsed`, `degraded`, `model` and the `place` value. After deploy,
`ops/smoke.sh` step 5b runs as usual and warns if Flash Lite, not Haiku, served
the turn (`ops/smoke.sh:358-360`).

## 7. How a fight starts from the map

1. When combat starts and the campaign has a current place, the combat-entry
   pipeline (`server-bun/src/services/combat-entry-pipeline.ts`) fills
   `environment`, `size` and `seed` from that place's `fight_*` values before
   the sanitizer runs. The DM's own values are used only when there is no
   current place.
2. Same place → same board on every visit.
3. After launch (location maps): a place may store authored cells instead of
   a recipe. The 5-ft cell rule stays.

`generateMap` does not change; only the source of the spec changes.

## 8. Fog of war and discovery

- **Region discovery (launch).** Three states: *visited* (full pin, art
  thumbnail on the card), *known* (dim pin marked "?"), *unknown* (not drawn).
  A zone shows only its name until one place in it is known. Hidden routes
  show only after the DM reveals them. The state is in text too ("Visited",
  "Known, not visited"), not only in colour.
- **Cell fog on fight boards (after launch).** The engine already stores
  `blocksSight` per cell; fog is a canvas draw plus a server sight query.

## 9. Phone, keyboard and the text list

**Entry point.** The `EXPLORING · <place>` plaque in
`src/features/game-session/components/game/overhaul/SceneHeader.tsx` becomes a
button named "Open map, you are at <place>". In combat it keeps opening the
fight board.

**Desktop (≥1024 px).** The map opens in the left rail, where the fight board
sits today. The rail exists only from 1024 px (`RAILS_SIDE_BY_SIDE` in
`use-game-rails.ts`, the same query GameLayout uses for the fight board), so
that is the breakpoint. The SVG takes the top; the **place list** sits under it in the
same panel.

**Phone (≤1023 px).** The map opens in the same sheet the fight board uses
(`GameMainContent.tsx:342-351`): it covers the story column from its top down
to the dock and never covers the roll tray or the composer, so the player can
read the map and type at the same time. Two tabs at the top of the sheet:
**Map** and **Places**. The SVG fits the sheet width; pinch and drag pan it; a
"You are here" button recentres. Pins and list rows are at least 44 px tall
(as #228 does for the game screen). At 390 px wide, 25 pins in 4 zones fit
with labels shown only for visited places and on tap for the rest.

**Place list (text alternative).** An ordered list grouped by zone. Each row:
place name, state in words, and "You are here" on the current place. Known
neighbours get a **Travel here** button in the row. The SVG has `role="img"`
and an `aria-label` that names the current place and the count of known
places; the list carries the full content, so a screen reader user never
needs the drawing.

**Keyboard.**

- Tab reaches the plaque button; Enter or Space opens the map.
- Inside, Tab moves through the tabs, the "You are here" button, then each
  pin (`<button>` elements in the SVG) in list order, then the list rows.
- Enter on a pin or row opens the place card; **Travel here** is a real
  `<button>` in the card and in the row.
- **Travel here** puts "I travel to <place>." in the composer and moves focus
  to the composer. It does not send.
- Escape closes the sheet or panel and returns focus to the plaque.

## 10. The Table look

The Table plaque uses navy `#0e1a36`, gold border `#d5b070` and cream text
`#f6e3b8` (`SceneHeader.tsx`). The region map uses the same three colours:
navy ground, gold routes and pin rims, cream labels in `ir-display`. Zones are
soft parchment-toned areas with a gold label. Known-not-visited pins are
dashed, not only dimmer, so the state does not depend on colour. A painted
background (option c) can slot under the SVG later without a data change.

## 11. Build issues (file as written)

Order: **1 first. Then 2 and 3 in parallel. Then 4. Then 5.** Issue 3 can start
before 1 merges, against a fixture graph JSON; it wires to the real route when
1 lands.

### Issue 1 — maps: place graph and routes at ingest (#1742)

- **Done means:** Re-ingesting each of the four starter campaigns writes
  `story_map_places` (one row per parsed place, with x/y and a fight recipe)
  and `story_map_edges`. Routes come from `Routes:` lines when the bible has
  them, else from an approved `routes.json`; ingest fails, naming the line,
  when a route names an unknown place. The ingest report prints place, zone
  and route counts per campaign and any renamed keys. `--propose-routes`
  writes `routes.proposed.json` with one model call (default model; the
  report prints tokens and cost). Migration and schema in one commit.
- **Files:** `tools/lore-keeper-ingest/src/chunker.ts` (routes parse),
  new `tools/lore-keeper-ingest/src/story-map.ts` (layout, recipe, proposal),
  `tools/lore-keeper-ingest/src/reingest-database.ts`,
  `scripts/reingest-starter-campaigns.ts`, new `db/schema/story-map.ts`,
  new `db/migrations/<date>_story_map.sql`, tests in
  `tools/lore-keeper-ingest/src/chunker.test.ts` and a new
  `story-map.test.ts`. Content repo: `Routes:` lines or `routes.json` per
  bible (content author; a prod data change needs Rob's line to apply).
- **Size:** M.

### Issue 2 — maps: current place and discovery per campaign (#1742)

- **Done means:** The DM reply has an optional narrative `place` field; the
  server accepts only valid keys (§6) and writes `story_map_progress` and
  `story_map_revealed_edges` with the owner filter. The prompt lists known
  places and neighbours. A second session of the same campaign opens at the
  last visited place with the same discovered places. A player-made campaign
  or a session with no `campaign_id` writes nothing. All §6 tests and the
  re-recorded fixture are in the PR; the Hetzner live probe result (both
  models) is pasted on the PR before PASS. `GET /v1/story-map/:campaignId`
  returns places, edges and progress for the owner only (real-route test).
- **Files:** `server-bun/src/services/dm/dm-response-schema.ts`, the §6 test
  files and fixture, new `server-bun/src/services/story-map/` (validation,
  progress writes), new `server-bun/src/routes/v1/story-map.ts`, the DM
  prompt builder that lists places, new
  `db/migrations/<date>_story_map_progress.sql` + schema.
- **Size:** M. **Needs:** issue 1 merged.

### Issue 3 — maps: region map and place list in the Table look (#1742)

- **Done means:** On a starter campaign, the plaque opens the map (left rail
  ≥1024 px; dock-bounded sheet with Map/Places tabs ≤1023 px). SVG shows zones,
  places in three states and known routes; the place list shows the same
  content in text. Travel here fills the composer and focuses it; nothing is
  sent. Full keyboard path and Escape behavior per §9; 44 px targets;
  screenshots at 390 px and 1280 px in the PR. Player-made campaigns show no
  map button. No new client dependency.
- **Files:** new `src/features/game-session/components/story-map/`
  (`RegionMap.tsx`, `PlaceList.tsx`, `PlaceCard.tsx`, `useStoryMap.ts` + tests),
  `src/features/game-session/components/game/overhaul/SceneHeader.tsx`,
  `src/features/game-session/components/game/game-content/GameMainContent.tsx`,
  `src/features/game-session/components/game/overhaul/LeftRailLive.tsx`.
- **Size:** M. **Parallel with:** issue 2 (start on a fixture graph).

### Issue 4 — maps: a fight at a place uses that place's board (#1742)

- **Done means:** When combat starts and the campaign has a current place,
  `scene_spec` environment, size and seed come from that place's recipe; the
  same place gives the same board in two fights (test). With no current place,
  today's behavior is unchanged (test).
- **Files:** `server-bun/src/services/combat-entry-pipeline.ts`,
  `server-bun/src/services/combat/scene-spec-sanitizer.ts` if the order
  changes, tests beside them.
- **Size:** S. **Needs:** issue 2 merged.

### Issue 5 — maps: stranger playtest of the region map (#1742)

- **Done means:** One Playtest run on a starter campaign after 1–4 are live:
  the marker follows the story across at least three places; Travel here
  works on a phone viewport; a second session opens at the last place with
  discovery kept; a fight at a known place matches its board on a repeat
  visit. Report in the Playtest format; follow-ups filed.
- **Files:** none (report issue).
- **Size:** S. **Needs:** 1–4 deployed.

## 12. After launch

- Location (room) maps for dungeons and towns, on the fight grid's 5-ft cells.
- Painted region art (option c) under the SVG pins, by Muse per campaign.
- Cell fog of war on fight boards.
- Maps for player-made campaigns (option d writing the same tables).
- Travel time and route encounters.

## 13. How other products show maps

| Product | Map | How made | Travel / discovery | Source |
|---|---|---|---|---|
| Friends & Fables (AI GM "Franz", 5e-like) | World map with a token, points of interest (POIs), battle maps with tokens | Map tools + AI location generators in a world-builder | Player tells Franz they leave a POI; Franz moves them by "specified" or "unspecified" POI travel | fables.gg blog and ACE 1.5 patch note (search snippets; the site did not resolve from this session) |
| DungeonOne (solo AI GM, iOS) | World map as a journal page beside quest log and NPC tracker | Journal element the AI reads | Not stated | App Store listing |
| 80 Days (inkle, text game) | Globe of 150+ cities | Hand-authored; each route has its own text | Pick a route; routes unlock by play; reviewers said "you are here" was sometimes hard to read | Giant Bomb, Emily Short's blog (snippets) |
| Endless RPG Solo Tools (iOS) | Random dungeon maps | Procedural, no AI | Fog-of-war reveal | App Store listing |
| Azgaar's Fantasy Map Generator | World/region | Seeded procedural, SVG renderer, editable | Authoring tool, not play | GitHub README (fetched) |

What we take from them: Friends & Fables proves the "token on a world map +
POIs + battle map" shape works for an AI 5e GM, and that travel can stay a
spoken request to the GM. 80 Days shows that discovered routes are enough to
make a text world feel mapped, and warns that "you are here" must be obvious.
Azgaar shows that a seeded procedural layout is reproducible and editable.

Limits: fables.gg, inklestudios.com and watabou.itch.io did not resolve from
this session, so those rows rest on search-result text, not on pages read.

## Sources

- Friends & Fables, "There's finally an AI RPG game with world maps, battle maps and tokens": https://fables.gg/blog/theres-finally-an-ai-rpg-game-with-world-maps-battle-maps-and-tokens (search snippet)
- Friends & Fables, ACE 1.5 patch note (travel system): https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations (search snippet)
- Friends & Fables on Product Hunt: https://www.producthunt.com/posts/friends-fables (search snippet)
- DungeonOne – AI Game Master, App Store: https://apps.apple.com/app/id6757712996 (search snippet)
- Endless RPG Solo Tools for D&D, App Store: https://apps.apple.com/us/app/id1321051898 (search snippet)
- 80 Days, Giant Bomb: https://www.giantbomb.com/games/3030-47793/ (search snippet)
- Emily Short on 80 Days: https://emshort.blog/2014/08/05/80-days-meg-jayanth-inkle/ (search snippet)
- Azgaar's Fantasy Map Generator: https://github.com/Azgaar/Fantasy-Map-Generator (page read)
- Gemini 3.1 Flash Lite price on OpenRouter: https://openrouter.ai/google/gemini-3.1-flash-lite (search snippet; openrouter.ai is blocked from this session)
- Claude Haiku 5.5 price: Anthropic model price list, $0.10 / $0.50 per 1M tokens for prompts up to 100K tokens (Claude API reference bundled with Claude Code, cached 2026-11-03)
