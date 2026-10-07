/**
 * #2533: one fixed 22-DM-turn session for measuring the DM prompt with the server's own
 * [PromptSections] counter (server-bun/src/services/prompt-section-counter.ts).
 *
 * The campaign is synthetic -- the real starter campaigns live in the database -- but it is sized
 * to the run D4 session on #2533 (a 22-DM-turn playthrough measured in prod): a canon block of
 * ~10.6k tokens, history that opens at ~0.5k and grows ~0.2k per turn, ~0.4k of story memories.
 * Three producers are real, not copied: `renderSceneStateFromFacts` (the `<scene_state>` block),
 * `ContextBuilder`/`GameContextPrompts`/`RulesPrompts` (everything under system_rules) and
 * `CampaignContextPrompts` (canon). Two are copied from their producers because those need a
 * database: the `<available_visual_assets>` block (src/services/ai/asset-processor.ts
 * `fetchCampaignAssetsForPrompt`) and the equipment loadout (`userDataApi.getCharacterLoadout`).
 */
import { renderSceneStateFromFacts } from '../../../../../server-bun/src/services/narrative/narrative-ledger-core';

import type { CampaignChunk, CampaignRule } from '@/agents/services/lore-keeper/data-mapping';

type EntityType = 'npcs' | 'locations' | 'factions' | 'items' | 'monsters' | 'handouts';

interface Seed {
  name: string;
  lead: string;
  image?: boolean;
  handout?: { key: string; giver: string };
}

const SEEDS: Record<EntityType, Seed[]> = {
  npcs: [
    {
      name: 'Warden Isolde Marrek',
      lead: 'Keeper of the Lamplight Row watch-house, a broad woman with a lantern-scar across her jaw.',
      image: true,
    },
    {
      name: 'Brother Tobin Vale',
      lead: 'A soft-spoken lay priest of the Order of the Pale Flame who tends the Drowned Chapel.',
      image: true,
    },
    {
      name: 'Madam Orsolya Finch',
      lead: 'Proprietor of The Hollow Lantern Inn and the best-informed gossip in the quarter.',
      image: true,
    },
    {
      name: 'Captain Dessa Korr',
      lead: 'Commander of the Harbor Watch, brisk, tired, and unwilling to chase ghost stories.',
      image: true,
    },
    {
      name: 'Old Pell',
      lead: 'A retired lamp-oil seller who sleeps in the Salt Market and sees more than he admits.',
      image: true,
    },
    {
      name: 'Sera Quillon',
      lead: 'A young apprentice at the Lantern Works who has stopped sleeping since the lights began to fail.',
      image: true,
    },
    {
      name: 'Vesper the Lamplighter',
      lead: 'The missing guild lamplighter whose route ended at the Undercroft stair.',
      image: true,
    },
    {
      name: 'Magistrate Hollis Crane',
      lead: 'The town magistrate, precise and politically cautious, who signs every writ himself.',
      image: true,
    },
    {
      name: 'Nim Tallow',
      lead: 'A street-wise runner of eleven who carries messages for anyone with a copper.',
      image: true,
    },
    {
      name: 'Dr. Anselm Roe',
      lead: 'A physician who treats the burn cases nobody else will explain.',
      image: true,
    },
    {
      name: 'Ketta Brightwater',
      lead: "A ferrywoman at Ferryman's Landing with a long memory for faces and debts.",
    },
    {
      name: 'Lord Aldric Wexmoor',
      lead: "Master of Wexmoor Manor, a collector of lanterns and of other people's secrets.",
    },
    {
      name: 'Marta Ironhand',
      lead: "The Lamplighters' Guild forewoman, who keeps the route ledgers in her head.",
    },
    {
      name: 'The Gray Courier',
      lead: 'A faceless messenger of the Gray Hand who is only ever seen leaving.',
    },
    {
      name: 'Yorick Dunmere',
      lead: 'A drunk gravedigger on Gallows Hill who talks to the dead and is sometimes answered.',
    },
    {
      name: 'Lysa Thornwood',
      lead: 'A traveling tinker whose cart carries mirrors, wicks and one very odd lantern.',
    },
  ],
  locations: [
    {
      name: 'The Hollow Lantern Inn',
      lead: 'A three-storey inn at the corner of Lamplight Row, warm, loud, and watched.',
      image: true,
    },
    {
      name: 'Lamplight Row',
      lead: 'A curved street of lamp-posts, half of them dark since the new moon.',
      image: true,
    },
    {
      name: 'The Drowned Chapel',
      lead: 'A chapel half-sunk in the tidal flats, reached by a causeway at low water.',
      image: true,
    },
    {
      name: 'Wexmoor Manor',
      lead: 'A walled estate on the northern rise, every window lit and none of them warm.',
      image: true,
    },
    {
      name: 'Salt Market',
      lead: 'A crowded open-air market of brine barrels, tarred canvas and loud bargaining.',
      image: true,
    },
    {
      name: 'The Undercroft',
      lead: 'A lightless cellar maze beneath Lamplight Row where the old gas-works once stood.',
    },
    {
      name: 'Gallows Hill',
      lead: 'A windblown rise above the town used for hangings and, now, for hiding things.',
    },
    {
      name: 'The Lantern Works',
      lead: "The guild foundry where the town's lanterns are cast, glassed and blessed.",
    },
    {
      name: "Ferryman's Landing",
      lead: 'A weathered quay where the night ferry takes anyone who does not ask its destination.',
    },
  ],
  factions: [
    {
      name: "The Lamplighters' Guild",
      lead: 'A trade guild that keeps the town lit and its routes secret.',
    },
    {
      name: 'Order of the Pale Flame',
      lead: 'A small order that believes darkness is a debt owed, not a hazard.',
    },
    {
      name: 'Harbor Watch',
      lead: 'The underfunded civic watch with jurisdiction up to the high-tide line.',
    },
    {
      name: 'The Gray Hand',
      lead: 'A courier-and-extortion ring that sells silence by the lantern-hour.',
    },
    {
      name: 'House Wexmoor',
      lead: "An old family whose wealth rests on the town's lamp-oil monopoly.",
    },
  ],
  items: [
    {
      name: 'The Ember Key',
      lead: 'A brass key that is always faintly warm and fits no lock in the town.',
    },
    {
      name: "Marrek's Ledger",
      lead: 'The watch-house ledger of missing persons, three pages freshly torn out.',
    },
    {
      name: 'Lantern of Unlit Hours',
      lead: 'A lantern that burns only when no one is looking at it.',
    },
    { name: 'Silvered Snuffer', lead: 'A candle snuffer that makes a sound like a held breath.' },
    {
      name: "Crane's Writ",
      lead: "A magistrate's writ of entry, signed but with the premises left blank.",
    },
    {
      name: 'The Hollow Coin',
      lead: 'A coin with a lantern-shaped hole that the Gray Hand accepts as payment.',
    },
    {
      name: 'Vial of Dark Oil',
      lead: 'A vial of black lamp-oil that drinks light instead of burning it.',
    },
  ],
  monsters: [
    {
      name: 'Shade Moth Swarm',
      lead: 'A cloud of pale moths that feed on lamp-flame and the warmth of whoever carries it.',
      image: true,
    },
    {
      name: 'Wick-Eater',
      lead: 'A long, sallow thing that hangs in dark lamp-housings and takes flames one at a time.',
      image: true,
    },
    {
      name: 'Drowned Acolyte',
      lead: 'A chapel penitent risen from the flats, still murmuring its last litany.',
      image: true,
    },
    {
      name: 'Gutter Ghoul',
      lead: 'A scavenger of the Undercroft drains, quick and cowardly alone, bold in packs.',
    },
    {
      name: 'Ashen Hound',
      lead: 'A grey hound-shape of soot that follows scent through walls and stops at running water.',
    },
    {
      name: 'The Unlit Thing',
      lead: 'What the lamps are keeping out. It has not yet been seen all at once.',
    },
  ],
  handouts: [
    {
      name: 'Torn Ledger Page',
      lead: 'A page torn from the watch-house ledger listing four names and a route.',
      handout: { key: 'torn-ledger-page', giver: 'Warden Isolde Marrek' },
    },
    {
      name: 'Guild Route Map',
      lead: 'A hand-drawn lamplighting route with one stop circled in red.',
      handout: { key: 'guild-route-map', giver: 'Marta Ironhand' },
    },
    {
      name: 'Chapel Litany',
      lead: 'A water-stained litany sheet with a verse underlined three times.',
      handout: { key: 'chapel-litany', giver: 'Brother Tobin Vale' },
    },
    {
      name: "Magistrate's Summons",
      lead: 'A summons to attend Magistrate Crane at the second bell.',
      handout: { key: 'magistrates-summons', giver: 'Magistrate Hollis Crane' },
    },
    {
      name: "Nim's Scrawled Note",
      lead: 'A scrawled note: three stops, one of them the manor kitchen door.',
      handout: { key: 'nims-note', giver: 'Nim Tallow' },
    },
  ],
};

const FILLER: Record<EntityType, string[]> = {
  npcs: [
    'Speaks in short, careful sentences and watches the door while talking, a habit from years of being listened to.',
    'Wants {a} kept quiet and will trade a favour for it, but will not say so first.',
    'Knows more about {b} than they will volunteer; a direct question about it makes them pause and reach for something to do with their hands.',
    'Secret: they once signed a document they did not read, and it tied them to {a}. They would rather die than see it surface.',
    'If the party earns their trust they can point toward {b}; if pressed too hard they send for the watch instead.',
    'Voice and manner: dry humour, never raises their voice, and remembers exactly what the party has said to them before.',
  ],
  locations: [
    'The air smells of lamp-oil, wet stone and old smoke, and the light here flickers even when there is no draught.',
    'Entrances: a main door that is rarely locked and a service passage that is rarely watched; sound carries badly in both.',
    'Residents and regulars include {a}, who is usually here after the second bell and notices strangers.',
    'A hidden detail rewards a careful search: scorch marks in a pattern that matches the route toward {b}.',
    'At night the place changes: the lamps gutter one by one, and anyone carrying a flame feels the cold lean toward it.',
    'Hazards and hooks: loose boards, a smothered lamp-housing, and a locked door whose key {a} is rumoured to have.',
  ],
  factions: [
    "Goals: preserve their standing in the town and keep their methods out of the magistrate's ledgers.",
    'Methods: favours, quiet pressure and an informant in every tavern; open violence only when the favour system fails.',
    'Relations: wary allies of {a}, open rivals of {b}, and publicly neutral about everything else.',
    'Ranks and symbols are worn small: a lapel pin, a wick-trimmer on the belt, a particular way of lighting a lamp.',
    'What they would pay the party for: silence, a retrieved object, or a name they have been unable to learn.',
  ],
  items: [
    'Appearance: plain at first glance, and only handling it for a few moments reveals what makes it unusual.',
    "History: it passed through {a}'s hands last, and has been looked for by {b} ever since.",
    'Properties: it does one thing reliably and one thing only when conditions are exactly right; the DM decides which, per the campaign bible.',
    "A careful examination (Investigation) reveals maker's marks that point toward the Lantern Works.",
    'Handling rule: it must be tracked as an item; it cannot be lost, duplicated or conjured by narration alone.',
  ],
  monsters: [
    'Tactics: avoids open light, strikes from the dark edge of a room, and retreats when its prey is not alone.',
    'Behaviour: drawn to flame and to warmth; it will pass a sleeping victim to reach a lit lantern.',
    'Habitat: lurks near {a}, and has been seen following the route toward {b}.',
    'Stat block: use the authored entry; the engine owns attack rolls, damage and hit points for this creature.',
    'Weakness: running water, a sealed lantern, or a flame blessed in the Order of the Pale Flame; none of these ends a fight outright.',
  ],
  handouts: [
    'The text of this handout is exactly what the player reads when it is delivered; do not paraphrase it in narration.',
    'It is given by its giver only when the party earns it, and it points toward {a}.',
    'A careful reader (Investigation) notices that the handwriting changes halfway down the page.',
  ],
};

const refName = (type: EntityType, index: number, offset: number): string => {
  const pool = [...SEEDS.npcs, ...SEEDS.locations];
  void type;
  return pool[(index * 3 + offset) % pool.length].name;
};

function describe(type: EntityType, seed: Seed, index: number): string {
  const sentences = FILLER[type].map((sentence) =>
    sentence.replace('{a}', refName(type, index, 1)).replace('{b}', refName(type, index, 7)),
  );
  return [seed.lead, ...sentences].join(' ');
}

export const FIXTURE_CAMPAIGN_ID = 'fixture-campaign-hollow-lantern';

export const FIXTURE_OVERVIEW = {
  title: 'The Hollow Lantern',
  premise:
    "In a harbor town where the lamps have begun to fail, a guild lamplighter has vanished and something that lives in the dark is learning the town's routes.",
  creativeBrief:
    'Tone: gothic-cozy mystery. Pace the dread; let warmth (the inn, the lamps, the people) be what the player fights for. Never resolve the Unlit Thing in a single scene.',
  overview: `The town of Lampwick has been lit by the Lamplighters' Guild for two hundred years, and the guild's routes are the town's real map. Eleven nights ago Vesper the Lamplighter failed to return from the Undercroft stair, and since then a lamp has gone dark on Lamplight Row every night, always in the same order. The Harbor Watch calls it vandalism, the Order of the Pale Flame calls it a debt coming due, and the Gray Hand has begun selling "light insurance". The party arrives as hired investigators with a writ from Magistrate Crane that names no premises, and every faction in town wants to know whom it was written for. Lampwick sits on a tidal estuary: the Salt Market and Ferryman's Landing face the water, Lamplight Row climbs from the quay to Gallows Hill, and Wexmoor Manor looks down on all of it. The Lantern Works supplies every lamp in the town, the Drowned Chapel keeps the Order's ledger of debts, and beneath Lamplight Row the Undercroft runs back to the old gas-works. Act one is the investigation of Lamplight Row and the inn; act two follows the dark lamps into the Undercroft and the Drowned Chapel; act three decides who the town trusts with its light, and what it is willing to give up to keep it.`,
};

export const FIXTURE_RULES: CampaignRule[] = [
  ['A lamp is extinguished', 'the nearest shadow deepens and a Shade Moth Swarm may follow', true],
  ['The party carries an open flame into the Undercroft', 'the Wick-Eater tracks them', false],
  [
    'The Hollow Coin is offered to a Gray Hand courier',
    'the courier answers one question honestly',
    false,
  ],
  ['A party member sleeps inside the Drowned Chapel', 'they dream of the Undercroft route', true],
  [
    "Magistrate Crane's Writ is shown",
    'the Harbor Watch must allow entry but will report it',
    false,
  ],
  ['The party kills a named NPC', "the Lamplighters' Guild closes its ledgers to them", false],
].map(([condition, effect, reversible], index) => ({
  id: `rule-${index}`,
  campaignId: FIXTURE_CAMPAIGN_ID,
  ruleType: 'world_law' as const,
  condition: condition as string,
  effect: effect as string,
  reversible: reversible as boolean,
  priority: index,
}));

const CHUNK_TYPE: Record<EntityType, CampaignChunk['chunkType']> = {
  npcs: 'npc_tier1',
  locations: 'location',
  factions: 'faction',
  items: 'item',
  monsters: 'monster',
  handouts: 'handout',
};

export function fixtureEntities(): Record<EntityType, CampaignChunk[]> {
  const out = {} as Record<EntityType, CampaignChunk[]>;
  for (const type of Object.keys(SEEDS) as EntityType[]) {
    out[type] = SEEDS[type].map((seed, index) => ({
      id: `${type}-${index}`,
      campaignId: FIXTURE_CAMPAIGN_ID,
      chunkType: CHUNK_TYPE[type],
      entityName: seed.name,
      content: describe(type, seed, index),
      metadata: {
        ...(seed.image ? { image_url: `https://example.invalid/${type}-${index}.png` } : {}),
        ...(seed.handout
          ? { key: seed.handout.key, title: seed.name, giver: seed.handout.giver }
          : {}),
      },
    }));
  }
  return out;
}

const ASSET_TYPE: Record<EntityType, string> = {
  npcs: 'npc',
  locations: 'location',
  factions: 'faction',
  items: 'item',
  monsters: 'monster',
  handouts: 'npc',
};
const assetKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Same text `fetchCampaignAssetsForPrompt` returns (src/services/ai/asset-processor.ts). */
export function fixtureAssetsSection(): string {
  const lines: string[] = [];
  for (const type of Object.keys(SEEDS) as EntityType[]) {
    for (const seed of SEEDS[type]) {
      if (seed.image)
        lines.push(`- ${seed.name} [ASSET:${ASSET_TYPE[type]}:${assetKey(seed.name)}]`);
    }
  }
  return `
<available_visual_assets>
<MANDATORY_REQUIREMENT>
You MUST include [ASSET:type:key] tags when introducing ANY entity from this list.
These tags display artwork to the player - WITHOUT the tag, the player sees NO image.

FORMAT: Place the tag IMMEDIATELY BEFORE the entity's name on first mention.
CORRECT: "As you enter, [ASSET:npc:elara] Elara greets you."
INCORRECT: "As you enter, Elara greets you [ASSET:npc:elara]."
</MANDATORY_REQUIREMENT>

${lines.join('\n')}
</available_visual_assets>`;
}

export const FIXTURE_CHARACTER = {
  id: 'fixture-character',
  name: 'Wren Ashdown',
  level: 3,
  race: 'Human',
  class: { name: 'Rogue' },
  background: 'Courier',
  character_stats: [
    {
      strength: 10,
      dexterity: 16,
      constitution: 13,
      intelligence: 12,
      wisdom: 14,
      charisma: 11,
      armor_class: 14,
    },
  ],
};

/** Same shape `userDataApi.getCharacterLoadout` returns (see game-context-prompts.test.ts). */
export const FIXTURE_LOADOUT = {
  weapons: [
    {
      id: 'inv-rapier',
      name: 'Rapier',
      damageDice: '1d8',
      damageType: 'piercing',
      normalRange: 5,
      magicBonus: 0,
      finesse: true,
      ranged: false,
      proficient: true,
    },
  ],
  armor: ['Leather Armor'],
  armorClass: 14,
};

/** Story memories the retriever would return: the same 6 every turn, ~0.4k tokens. */
export const FIXTURE_MEMORIES = [
  [
    'STORY',
    'The party arrived in Lampwick with a writ from Magistrate Hollis Crane that names no premises.',
  ],
  [
    'NPC',
    'Madam Orsolya Finch told the party that Vesper the Lamplighter last drank at The Hollow Lantern Inn eleven nights ago.',
  ],
  [
    'EVENT',
    'The lamp at the end of Lamplight Row went dark while Wren was watching it; no one lit or touched it.',
  ],
  ['NPC', 'Nim Tallow runs messages for the Gray Hand but will answer a question for a copper.'],
  ['ITEM', 'Wren holds the Ember Key, which is warm to the touch and has not yet fit a lock.'],
  [
    'LOCATION',
    'The causeway to the Drowned Chapel is only open at low water, which is after the second bell.',
  ],
  [
    'NPC',
    'Captain Dessa Korr dismisses the dark lamps as vandalism and wants evidence before she will commit the Harbor Watch.',
  ],
  [
    'FACT',
    'The Gray Hand sells "light insurance" to shopkeepers on Lamplight Row and has begun to collect.',
  ],
].map(([type, content], index) => ({ id: `mem-${index}`, type, content }));

interface Turn {
  player: string;
  dm: string;
  /** Ledger entities in the scene after this turn: [type, name]. */
  scene: Array<[string, string]>;
}

const DM_PAD =
  " The lamps along the row gutter in sequence, as if something were walking past them, and the smell of lamp-oil gets sharper. Wren's shadow leans a fraction too far toward the nearest dark window. Somewhere above, a shutter bangs once and is still; the rain drums on the slates, and for a moment every sound in the street seems to be listening. What you do next will be noticed, and not only by the people who can see you.";

export const FIXTURE_OPENING_DM =
  "Rain has been falling on Lampwick for three days, and tonight the lamps along Lamplight Row are failing one at a time. You step down from the night ferry at Ferryman's Landing with Magistrate Hollis Crane's writ folded inside your coat, its premises line left blank on purpose. The Harbor Watch has already chalked a cross on the nearest post: someone has been here and left. Lamplight Row curves up from the quay, and at its corner The Hollow Lantern Inn glows with a warmth that seems almost defiant. Behind you the ferryman pushes off without a word. Ahead, the fourth lamp from the inn goes out as you watch." +
  " The street is nearly empty: a shuttered chandler's, a cart abandoned with its shafts in the gutter, a cat that will not cross the lamplight. From somewhere below the cobbles comes a sound like a long breath drawn through a narrow stair, and then nothing. The ferryman's lantern recedes across the water behind you, and the only warmth left in the night is the glow in the inn's windows. Your writ is the only authority you carry, and it is a blank one. The people here have been frightened for eleven nights; they will watch what you do before they trust what you say. Every lamp on the row is a witness, and tonight most of them are dark.";

export const FIXTURE_TURNS: Turn[] = [
  {
    player: 'I walk up Lamplight Row toward The Hollow Lantern Inn.',
    dm:
      'You climb Lamplight Row past three dark lamp-posts. At the inn\'s door a woman in an apron is wiping the lintel with a rag as though to scrub the dark off it. "Late to be arriving," says Madam Orsolya Finch. "Come in, the fire is lit and the ale is not yet watered."' +
      DM_PAD,
    scene: [
      ['location', 'The Hollow Lantern Inn'],
      ['npc', 'Madam Orsolya Finch'],
    ],
  },
  {
    player: 'I ask Madam Orsolya Finch about the missing lamplighter.',
    dm:
      'Madam Orsolya Finch lowers her voice. "Vesper? Eleven nights gone. Drank his last cup right there by the stove and said he had one more route to walk." She nods at a boy in the corner. "Nim Tallow saw which way he went, if a copper loosens his memory."' +
      DM_PAD,
    scene: [
      ['location', 'The Hollow Lantern Inn'],
      ['npc', 'Madam Orsolya Finch'],
      ['npc', 'Nim Tallow'],
    ],
  },
  {
    player: 'I flip a copper to Nim Tallow and ask which way Vesper went.',
    dm:
      'Nim Tallow snatches the copper out of the air. "Down the Undercroft stair, behind the old gas-works wall. He had a lantern that wasn\'t lit and he was talking to it." The boy shrugs. "Lamplighters talk to lamps."' +
      DM_PAD,
    scene: [
      ['location', 'The Hollow Lantern Inn'],
      ['npc', 'Nim Tallow'],
    ],
  },
  {
    player: 'I thank Nim and look around the common room for anyone else listening.',
    dm:
      'The common room is warm and loud, but one table near the window is conspicuously quiet: a figure in grey sits with their face turned to the glass. When you look, they rise and leave by the side door without finishing their drink.' +
      DM_PAD,
    scene: [
      ['location', 'The Hollow Lantern Inn'],
      ['npc', 'The Gray Courier'],
    ],
  },
  {
    player: 'I follow the grey figure out the side door.',
    dm:
      'Rain slaps your face. The figure is already halfway down the alley, and as you reach the corner they pass a coin into the hand of a doorway shadow. "The Hand sends its regards," a voice says, "and wants to know who is asking questions about Vesper."' +
      DM_PAD,
    scene: [
      ['location', 'Lamplight Row'],
      ['npc', 'The Gray Courier'],
    ],
  },
  {
    player: "I tell them I am a hired investigator and show Crane's Writ.",
    dm:
      'The voice is quiet for a moment. "A writ with no address. Magistrate Crane is either very clever or very afraid." A hollow coin spins out of the dark and lands at your feet. "One honest answer, for that."' +
      DM_PAD,
    scene: [
      ['location', 'Lamplight Row'],
      ['npc', 'The Gray Courier'],
    ],
  },
  {
    player: 'I pick up the Hollow Coin and ask what lives in the Undercroft.',
    dm:
      'The coin is cold and has a lantern-shaped hole through its middle. "Not what lives," the voice answers, "what waits. The lamps keep it out. Ask yourself why they are failing." The shadow is empty by the time you look up.' +
      DM_PAD,
    scene: [['location', 'Lamplight Row']],
  },
  {
    player: 'I head to the Harbor Watch to speak with Captain Dessa Korr.',
    dm:
      'The Harbor Watch post is a squat stone building by the quay. Captain Dessa Korr looks up from a ledger and does not hide her weariness. "If you are here about lamps, I will say it once: vandalism. If you have a better word, bring evidence."' +
      DM_PAD,
    scene: [
      ['location', "Ferryman's Landing"],
      ['npc', 'Captain Dessa Korr'],
    ],
  },
  {
    player: "I show Captain Korr the writ and ask to see Warden Marrek's missing-persons ledger.",
    dm:
      'Captain Dessa Korr reads the writ twice. "The ledger is at the Lamplight Row watch-house. Warden Isolde Marrek keeps it. She will not like you." She stamps something on a slip. "Tell her I said to show you, and that I said to count the pages first."' +
      DM_PAD,
    scene: [
      ['location', "Ferryman's Landing"],
      ['npc', 'Captain Dessa Korr'],
      ['npc', 'Warden Isolde Marrek'],
    ],
  },
  {
    player: 'I go to the watch-house and ask Warden Isolde Marrek for the ledger.',
    dm:
      'Warden Isolde Marrek turns the ledger toward you without a word. Three pages have been torn out, close to the spine, the tears fresh. "I did not do that," she says. "And I did not see who did, which is worse."' +
      DM_PAD,
    scene: [
      ['location', 'Lamplight Row'],
      ['npc', 'Warden Isolde Marrek'],
      ['item', "Marrek's Ledger"],
    ],
  },
  {
    player: 'I examine the torn edges of the pages for anything left behind.',
    dm:
      'A careful look at the torn edges shows a smear of black oil along the binding, and a single ash-grey hair caught in the thread. The oil does not catch the lamplight; it seems to swallow it.' +
      DM_PAD,
    scene: [
      ['location', 'Lamplight Row'],
      ['npc', 'Warden Isolde Marrek'],
      ['item', 'Vial of Dark Oil'],
    ],
  },
  {
    player: 'I ask Warden Marrek who in Lampwick uses black lamp-oil.',
    dm:
      'Warden Isolde Marrek frowns. "Nobody legal. House Wexmoor holds the oil monopoly and their oil burns amber. Black oil is a rumour from the Lantern Works. Sera Quillon, the apprentice there, hasn\'t slept since it started."' +
      DM_PAD,
    scene: [
      ['location', 'Lamplight Row'],
      ['npc', 'Warden Isolde Marrek'],
      ['npc', 'Sera Quillon'],
    ],
  },
  {
    player: 'I walk to the Lantern Works to find Sera Quillon.',
    dm:
      "The Lantern Works is a roar of furnaces and the smell of hot glass. Sera Quillon is at a bench, hands shaking over a half-cast lantern. When you say Vesper's name her tools clatter to the floor." +
      DM_PAD,
    scene: [
      ['location', 'The Lantern Works'],
      ['npc', 'Sera Quillon'],
    ],
  },
  {
    player: 'I help Sera pick up her tools and ask her what she knows about the black oil.',
    dm:
      'Sera Quillon drags in a shaky breath. "Someone has been ordering black oil from the guild foundry under Marta Ironhand\'s seal. But Marta says she never signed it." She slides a stained route map across the bench. "Take it. Please."' +
      DM_PAD,
    scene: [
      ['location', 'The Lantern Works'],
      ['npc', 'Sera Quillon'],
      ['npc', 'Marta Ironhand'],
    ],
  },
  {
    player: 'I study the guild route map for the circled stop.',
    dm:
      "One stop is circled in red: the Undercroft stair behind the old gas-works. Next to it, in different ink, someone has written a time: the hour after the second bell. Vesper's route ends there, and so, the map suggests, does every dark lamp's." +
      DM_PAD,
    scene: [
      ['location', 'The Lantern Works'],
      ['npc', 'Sera Quillon'],
    ],
  },
  {
    player: 'I ask Marta Ironhand to confirm the seal on the order.',
    dm:
      'Marta Ironhand sets her jaw. "That seal is mine. That hand is not." She taps the order. "Someone close to the guild is forging in my name. If you find them, bring them to me before the Watch does."' +
      DM_PAD,
    scene: [
      ['location', 'The Lantern Works'],
      ['npc', 'Marta Ironhand'],
    ],
  },
  {
    player: 'I leave the foundry and head for the Drowned Chapel.',
    dm:
      'The causeway to the Drowned Chapel is open at low water, wet and shining under the dark sky. Halfway across you hear the murmur of a litany from the flats, though no one is on them. The chapel door stands ajar and a single candle burns inside.' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
    ],
  },
  {
    player: 'I speak with Brother Tobin Vale about the lamps.',
    dm:
      'Brother Tobin Vale does not look surprised. "The lamps are a debt, child. The Order of the Pale Flame keeps the ledger of it." He touches the candle as though to steady it. "Vesper took the debt upon himself. That is why the stair is open."' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
      ['faction', 'Order of the Pale Flame'],
    ],
  },
  {
    player: 'I ask Brother Tobin what happens if the debt is not paid.',
    dm:
      'Brother Tobin Vale is silent so long that the candle gutters. "Then the thing the lamps keep out comes in. The Unlit Thing does not hurry, you understand. It simply arrives." He hands you a water-stained litany sheet with a verse underlined three times.' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
      ['monster', 'The Unlit Thing'],
    ],
  },
  {
    player: 'I read the underlined verse aloud.',
    dm:
      'The verse speaks of "a flame given freely, not taken". As you speak the words, the single candle flares blue for a heartbeat and the murmur on the flats stops. Something outside lets out a long, patient breath.' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
      ['monster', 'Drowned Acolyte'],
    ],
  },
  {
    player: 'I tell Brother Tobin I will carry a flame down the Undercroft stair.',
    dm:
      'Brother Tobin Vale shakes his head slowly. "Not alone, and not an open flame. The Wick-Eater tracks open flame." He offers you a sealed lantern from the altar. "This may be enough. It will not be pleasant."' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
      ['item', 'Lantern of Unlit Hours'],
    ],
  },
  {
    player: 'I take the lantern and ask Brother Tobin the way to the Undercroft stair.',
    dm:
      'Brother Tobin Vale points back across the causeway. "The old gas-works wall on Lamplight Row. Behind it, the stair. Go after the second bell, when the water has left the flats and the dark is thinnest." He presses the lantern into your hands. "Come back."' +
      DM_PAD,
    scene: [
      ['location', 'The Drowned Chapel'],
      ['npc', 'Brother Tobin Vale'],
    ],
  },
];

const FIXTURE_OPENING_SCENE: Array<[string, string]> = [['location', "Ferryman's Landing"]];

/**
 * The `<scene_state>` block the ledger holds when the DM is called for turn `turnIndex`
 * (1-based): the scene the previous reply left, so the opening reply's scene for turn 1.
 * Null for the opening call itself, before any fact exists.
 */
export function fixtureSceneState(turnIndex: number): string | null {
  if (turnIndex <= 0) return null;
  const scene = turnIndex === 1 ? FIXTURE_OPENING_SCENE : FIXTURE_TURNS[turnIndex - 2].scene;
  const facts = scene.map(([subjectType, subjectName]) => ({
    subjectType,
    subjectName,
    predicate: subjectType === 'location' ? 'party_is_here' : 'present',
    value: true,
    source: 'dm_delta',
    knownBy: ['dm'],
    isBelief: false,
    needsReview: false,
    turnIndex: turnIndex - 1,
  }));
  return renderSceneStateFromFacts(facts);
}

export const FIXTURE_CURRENT_SCENE =
  'A rain-slicked night on Lamplight Row; the lamps are failing in order.';
