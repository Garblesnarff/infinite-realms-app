# Story maps: a map for the story, not only fights

**Issue:** #1742 (P1)
**Status:** design spike; no production behavior changes
**Review constraint:** Draft only — do not merge

Rob, 11-24: "There is no map in the story currently. We need to figure out how
we would generate those for the worlds." This doc says what a story map is for
Infinite Realms, compares four ways to make one, and recommends the smallest
launch version. Rob picks the direction; then the build issues in the last
section get filed.

## Bottom line

Launch with a **region map made once per campaign at ingest**: the bible's
places become a graph (places + routes), a script lays the graph out, and the
client draws it as SVG in the Table look. The player sees where they are, which
places they found, and which routes lead on. A tap on a known neighbour sends
"I travel to X" to the DM. Each place also stores a fight-board recipe
(`environment`, `size`, `seed`), so a fight that starts there gets the same
board every time. Cost: under $0.01 per campaign, $0 per session, no new
client library. Room-level location maps, painted map art and DM-drawn
layouts wait until after launch.

## 1. What is on main today (read at `4417bba`)

| Area | What exists | File |
|---|---|---|
| Fight grid | Server-authoritative grid, 1 cell = 5 ft, terrain + cover + sight per cell. | `ai-adventure-scribe-main/server-bun/src/tactical/types.ts` |
| Fight board generator | `generateMap(spec)` builds a board from `environment` (9 values: `dungeon_room`, `cave`, `tavern`, `forest_clearing`, `road`, `ruins`, `ship_deck`, `open_field`, `corridor`), `size` (10×10, 14×12, 20×16) and `seed`. Deterministic: same spec + seed = same board. Uses `rot-js` (server only). | `server-bun/src/tactical/generator.ts:8,114` |
| Fight storage | `tactical_maps` row per session, `state` jsonb, one active per session. No link to a place. | `db/schema/tactical-maps.ts` |
| DM hook | The DM sends `scene_spec` when a fight starts and `map_actions` during it; the sanitizer rejects an unknown `environment`. | `server-bun/src/services/dm/dm-response-schema.ts:182`, `server-bun/src/services/combat/scene-spec-sanitizer.ts:48` |
| Fight canvas | 2D canvas, DPR-aware, pointer + two-finger pinch, height `min(52vh,520px)`. | `src/features/game-session/components/tactical/TacticalMapCanvas.tsx:110,272,323` |
| Bible places | Ingest makes one `location` chunk per place. Two bible shapes: `### Zone N: Name` + numbered places (zone kept as `parentEntity` and `metadata.zone`), or bullet places with no zone. | `tools/lore-keeper-ingest/src/chunker.ts:451-530` |
| Place art | `campaign_chunks.metadata.image_url` per place, loaded by `useCampaignAssets`; re-ingest keeps it. | `src/hooks/use-campaign-assets.ts`, `scripts/reingest-starter-campaigns.ts` |
| Routes between places | **None.** The chunker keeps zone → place only. No "leads to" or "connects" field is parsed. NPC rows carry a free-text `Location`. | `chunker.ts:247,283` |
| Old `locations` table | Has `connected_locations` and `map_url` columns, keyed to user `campaigns.id` (uuid). Only a read mapper uses them; nothing in the repo writes them. | `db/schema/world.ts:59-84`, `server-bun/src/routes/v1/world-builder.ts:66-68` |
| "Where am I" | The Table plaque shows `EXPLORING` + a place name. The name is the free text `context.location` of the newest message that has one, found on the client. It is not an id. | `src/features/game-session/components/game/game-content/GameMainContent.tsx:354`, `overhaul/SceneHeader.tsx` |

Two facts shape the design:

1. **There is no route data.** Any map with roads or doors needs one new step
   that reads the place text and writes edges.
2. **The current place is free text on the client.** A map needs the server to
   know the current place as a key that matches a `location` chunk.

I could not read the four starter bibles (the content repo is private and not
attached to this session). Place counts per campaign are therefore not
measured; costs below are given per place where that matters.

## 2. What a story map means here

| Kind | Scale | Player does | Launch? |
|---|---|---|---|
| **Region map** | Zones and places of one campaign, routes between them. Not to scale. | See where they are; see places found and routes known; tap a neighbour to travel; open a place card (art + summary). | **Yes** |
| **Location map** | Rooms of a dungeon, streets of a town. 5-ft grid or near it. | Walk room to room; see doors; a fight starts on the same layout. | After launch |
| **Fight board** | One encounter area, 5-ft cells. | Exists today. | Exists; gains a fixed recipe per place |

A solo text RPG is driven by prose. The map supports the prose; it does not
replace it. So the map never moves the character by itself: a tap sends a
player line, and the DM reply moves the "you are here" marker.

## 3. Generation options

Prices come from `server-bun/src/services/model-pricing.ts`:
text `gemini-3.1-flash-lite-preview` row $0.25 / $1.50 per 1M in/out (the
default DM model is `google/gemini-3.1-flash-lite`, `llm-model-config.ts:5`);
image `google/gemini-3.1-flash-image` $60 per 1M image-output tokens. Image
tokens per picture are an estimate (about 1,300 for a 1K image, from Google's
published figure for its flash-image models), so about **$0.08 per image**.

| Option | How it works | Cost per campaign | Cost per session | Quality | Build size |
|---|---|---|---|---|---|
| **(a) Authored at ingest** | One LLM pass over the bible's location section writes `{places, zones, edges}` as JSON. A person checks the JSON once (it lives beside the bible). A layout step gives each place x/y. | ~10k in + 2k out ≈ **$0.006** | **$0** | High for the graph (checked once); layout is plain. | M: extractor + schema + review file. |
| **(b) Procedural layout, fixed style** | Takes the graph from (a). Zones become labelled areas in story order; places are pins inside them; routes are lines. Coordinates are computed once at ingest and stored; the client only draws SVG. | Same as (a) | **$0** | Clean, readable, same look in every campaign. Not "painted". | M on top of (a). No client library: a small seeded force or grid layout runs at ingest. |
| **(c) Painted map art + hotspots** | One image-model call per campaign for a region painting (and one per place for location art). Hotspots from the graph are placed on the image. | Region: ~$0.08 × retries (assume 3–5 to get a usable one) ≈ **$0.25–0.40**. Location maps: + ~$0.08–0.40 per place. | **$0** | Looks best when it works. Image models cannot be trusted to put places where the graph says, or to spell labels, so hotspots need a person or a vision pass per image. Art goes stale if the bible changes. | L: art pipeline, hotspot editor or vision pass, curation by Muse. |
| **(d) DM at runtime** | The DM emits a layout (like `scene_spec`) the first time the player enters a place; the server builds it and stores it. | $0 | Extra ~300 output tokens per new place ≈ **$0.0005**, plus prompt growth. | Lowest. The DM already needs a sanitizer for `scene_spec`; free-form layouts add a new failure surface. Places drift between visits unless stored. Fits user-made campaigns that have no bible. | M: schema, sanitizer, storage, prompt. |

**Mixes that make sense:**

- **(a)+(b)** for launch: one graph, one fixed look. Starter campaigns only.
- **(a)+(b)+(c) later**: the painted map becomes the background layer; the SVG
  pins stay on top, so the graph is still the truth and hotspots come free.
- **(d) for user-built campaigns** later, writing into the same graph shape, so
  one renderer serves both.

## 4. Data shape (proposal)

One new table, keyed to the starter campaign, filled at ingest:

```
story_map_places
  campaign_id      text   -> starter_campaigns.id
  place_key        text   generateAssetKey(entity_name), matches campaign_chunks
  zone_key         text   null when the bible has no zones
  x, y             real   0..1, computed at ingest
  fight_env        text   one of the 9 SceneEnvironment values
  fight_size       text   small | medium | large
  fight_seed       int
story_map_edges
  campaign_id, from_key, to_key, label text (e.g. "rope bridge"), hidden bool
```

Per session, a small state record (jsonb on `game_sessions` or a table):
`current_place_key`, `discovered_keys[]`, `known_edge_ids[]`. The server sets
`current_place_key` from the DM reply (a new optional `place` field that must
match a known key; anything else is ignored), not from client free text.

The old `locations.connected_locations` / `map_url` columns belong to the user
campaign world-builder and are keyed differently; this design does not reuse
them (see Friction).

## 5. How a fight starts from the map

Today the DM picks `scene_spec.environment` and the seed. With a story map:

1. When combat starts and `current_place_key` is set, the combat-entry
   pipeline fills `environment`, `size` and `seed` from that place's
   `fight_*` row. The DM's own values are used only when no place is known.
2. Same place → same board on every visit, so the fight matches the map.
3. Later (location maps): a place may store authored `cells` instead of a
   recipe, and `generateMap` takes them as-is. The 5-ft cell rule stays.

This reuses `generateMap` unchanged for launch; only the spec source changes.

## 6. Fog of war and discovery

Two layers, both server state, both per session:

- **Region discovery (launch).** A place shows in one of three states:
  *visited* (full pin, art thumbnail), *known* (a dim pin with a "?" — named
  by the DM or reached by a known route), *unknown* (not drawn). Zones show
  only their name until one place in them is known. Hidden edges
  (`hidden = true`, for secret passages) appear only after the DM reveals them.
  The DM prompt gets the known/visited lists so it does not "reveal" a place
  the map already shows, and does not mention unknown places as known.
- **Cell fog on fight boards (after launch).** The engine already has
  `blocksSight` per cell. Fog = cells outside the party's sight are dimmed on
  the canvas. This is a client draw change plus a server sight query; it is
  not needed for the region map.

80 Days uses the same idea: routes unlock through play, and travel is the
interaction (see Sources).

## 7. Phone layout

The game screen already switches at 699 px (`SceneHeader.tsx`, `max-[699px]`)
and the fight canvas already supports pinch (`TacticalMapCanvas.tsx:323`).

- **Entry point:** the `EXPLORING · <place>` plaque becomes a button. Tap opens
  the map as a bottom sheet (phone) or the left-rail panel (desktop), the same
  places the fight board uses today (`GameMainContent.tsx`, #90 comment).
- **Size:** SVG scales to width; pinch and drag to pan; a "you are here" button
  recentres. Pins are at least 44 px tap targets (matches #228's tap-target
  work).
- **Tap a pin:** opens a place card (art from `metadata.image_url`, one-line
  summary). If the place is a known neighbour, the card has **Travel here**.
- **In combat:** the sheet shows the fight board, not the region map.

## 8. The Table look

The Table plaque uses navy `#0e1a36`, gold border `#d5b070` and cream text
`#f6e3b8` (`SceneHeader.tsx`). The region map uses the same three colours:
navy ground, gold routes and pin rims, cream labels in `ir-display`. Zones are
soft parchment-toned areas with a gold label. No painted texture at launch;
a texture or painted background (option c) can slot under the SVG later
without changing the data.

## 9. How other products show maps

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

## 10. Recommendation

**For launch: (a)+(b) region map, starter campaigns only.**

- Graph from the bible at ingest, checked once, stored with x/y.
- SVG region map in the Table look; plaque opens it; bottom sheet on phone.
- Server-tracked current place + discovered places; three pin states.
- Tap a known neighbour → "I travel to X" in the composer (player still sends).
- Fights at a known place use that place's fixed board recipe.

Why this one: it is the only option with $0 per session, no image risk, no new
client library and no new DM failure surface, and it ships every item Rob
named (looks, moving, matches the story, phone) at region scale.

**After launch:**

- Location (room) maps for dungeons and towns, sharing the fight grid's 5-ft
  cells; fights start on the actual room.
- Painted region art (c) under the SVG pins, made by Muse per campaign.
- Cell fog of war on fight boards.
- DM-generated graphs (d) for user-built campaigns with no bible.
- Travel time / random encounters on routes.

## 11. Build issues to file (after Rob picks)

1. **Place graph at ingest.** Extract `{places, zones, edges}` from the bible
   location section into a reviewed JSON file per starter campaign; add
   `story_map_places` / `story_map_edges` (one migration tree, AGENTS §7);
   compute x/y and a `fight_*` recipe per place. Size M.
2. **Server current place.** Optional `place` field in the DM reply schema,
   validated against `place_key`s; per-session `current_place_key`,
   `discovered_keys`, `known_edge_ids`; DM prompt gets the known lists. Size M.
3. **Region map UI.** SVG renderer in the Table look; plaque button; bottom
   sheet ≤699 px, left rail above; place card with art; Travel here fills the
   composer. Size M.
4. **Fight board from place.** Combat-entry pipeline fills `scene_spec`
   environment/size/seed from the current place's recipe when one exists;
   real-route test per AGENTS §4. Size S.
5. **Playtest pass.** One stranger run on a starter campaign with the map:
   does the marker follow the story; does the fight board match the place.
   Size S.

## Sources

- Friends & Fables, "There's finally an AI RPG game with world maps, battle maps and tokens": https://fables.gg/blog/theres-finally-an-ai-rpg-game-with-world-maps-battle-maps-and-tokens (search snippet)
- Friends & Fables, ACE 1.5 patch note (travel system): https://fables.gg/patch-notes/ace-15-bringing-pois-and-npcs-to-life-npc-conversations (search snippet)
- Friends & Fables on Product Hunt: https://www.producthunt.com/posts/friends-fables (search snippet)
- DungeonOne – AI Game Master, App Store: https://apps.apple.com/app/id6757712996 (search snippet)
- Endless RPG Solo Tools for D&D, App Store: https://apps.apple.com/us/app/id1321051898 (search snippet)
- 80 Days, Giant Bomb: https://www.giantbomb.com/games/3030-47793/ (search snippet)
- Emily Short on 80 Days: https://emshort.blog/2014/08/05/80-days-meg-jayanth-inkle/ (search snippet)
- Azgaar's Fantasy Map Generator: https://github.com/Azgaar/Fantasy-Map-Generator (page read)
