import { describe, it, expect } from 'vitest';

import {
  CampaignContextPrompts,
  type StarterCampaignLore,
  type TurnCanonScope,
} from '../campaign-context-prompts';

import type { CampaignChunk } from '@/agents/services/lore-keeper/data-mapping';

function chunk(
  name: string,
  content: string,
  metadata: Record<string, unknown> = {},
): CampaignChunk {
  return {
    id: `chunk-${name}`,
    campaignId: 'campaign-1',
    chunkType: 'npc_tier1',
    entityName: name,
    content,
    metadata,
  };
}

const smallLore: StarterCampaignLore = {
  title: 'The Gilded Cauldron',
  premise: 'A culinary academy hides a delicious secret.',
  creativeBrief: 'Cozy and whimsical.',
  overviewText: 'Founded centuries ago by traveling chefs.',
  rules: [
    {
      id: 'rule-1',
      campaignId: 'campaign-1',
      ruleType: 'world_law',
      condition: 'When a dish is served',
      effect: 'the judges react',
      reversible: false,
      priority: 1,
    },
  ],
  entitiesByType: {
    npcs: [
      chunk(
        'Headmaster Brine',
        'A stern halfling who runs the academy kitchen with an iron ladle.',
        {
          image_url: 'https://example.com/brine.png',
        },
      ),
      chunk('Sous-Chef Pip', 'A nervous gnome apprentice.'),
    ],
    locations: [chunk('The Grand Kitchen', 'Copper pots hang above a roaring hearth.')],
    factions: [],
    items: [],
    monsters: [],
    handouts: [],
  },
  assetsSection: '',
};

/**
 * Expected output for `smallLore`, generated from the PRE-CHANGE
 * buildStarterCampaignLoreSection (pristine main) with the same fixture data.
 * This is the byte-identity anchor: the uncut path must not drift from it.
 */
const LEGACY_SMALL_LORE_OUTPUT = `
<starter_campaign_lore>
<canonical_setting>
TITLE: The Gilded Cauldron
PREMISE: A culinary academy hides a delicious secret.
OVERVIEW: Founded centuries ago by traveling chefs.
</canonical_setting>

<creative_direction>
Cozy and whimsical.
</creative_direction>
<world_rules>
These rules govern how the world responds to player actions:
- When a dish is served → the judges react
</world_rules>

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>

<npcs count="2">
<npc name="Headmaster Brine" asset_tag="[ASSET:npc:headmaster-brine]">
A stern halfling who runs the academy kitchen with an iron ladle.
**VISUAL: Use [ASSET:npc:headmaster-brine] when introducing this character**
</npc>
<npc name="Sous-Chef Pip">
A nervous gnome apprentice.
</npc>
</npcs>

<locations count="1">
<location name="The Grand Kitchen">
Copper pots hang above a roaring hearth.
</location>
</locations>
</canonical_entities>

<lore_adherence>
- USE the canonical NPCs listed above - do NOT invent new characters when these exist
- When introducing an NPC from the list, use their EXACT name
- Reference canonical locations and describe them as specified
- Apply world rules consistently
- **CRITICAL: Include the asset_tag shown for any entity with a portrait/image when you first mention them**
- Asset tags like [ASSET:npc:headmaster] display the entity's artwork to the player
</lore_adherence>
</starter_campaign_lore>`;

describe('CampaignContextPrompts.renderStarterCampaignLore', () => {
  it('renders small canon byte-identical to the pre-budget behavior', () => {
    const result = CampaignContextPrompts.renderStarterCampaignLore(smallLore);
    expect(result.section).toBe(LEGACY_SMALL_LORE_OUTPUT);
    expect(result.canonCut).toBe(false);
    expect(result.keptEntities).toBe(3);
    expect(result.droppedEntities).toBe(0);
  });

  it('leaves small canon untouched when a generous budget is passed', () => {
    const uncut = CampaignContextPrompts.renderStarterCampaignLore(smallLore);
    const budgeted = CampaignContextPrompts.renderStarterCampaignLore(smallLore, {
      tokenBudget: 50_000,
      recentTurnsText: 'the party talked to Headmaster Brine',
    });
    expect(budgeted.section).toBe(uncut.section);
    expect(budgeted.canonCut).toBe(false);
  });

  it('caps a 27k-token canon, keeps the overview/rules/adherence, and flags the cut', () => {
    // ~60 entities x ~450 tokens: a canon that would previously starve history.
    const npcs: CampaignChunk[] = Array.from({ length: 60 }, (_, i) =>
      chunk(`Kitchenhand ${i}`, `Description of Kitchenhand ${i}. ` + 'x'.repeat(1800)),
    );
    // Relevance targets sit at the END of fetch order: without ranking they die first.
    npcs[55] = chunk('Chef Marrow', "The academy's reclusive head chef. " + 'x'.repeat(1800));
    npcs[59] = chunk('Active NPC', 'Currently standing in the scene. ' + 'x'.repeat(1800));

    const lore: StarterCampaignLore = {
      ...smallLore,
      rules: [],
      entitiesByType: {
        npcs,
        locations: [],
        factions: [],
        items: [],
        monsters: [],
        handouts: [],
      },
    };

    const rawEntityTokens = Math.ceil(
      npcs.map((e) => e.content.length).reduce((a, b) => a + b, 0) / 4,
    );
    expect(rawEntityTokens).toBeGreaterThan(24_000);

    const result = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      tokenBudget: 13_000,
      recentTurnsText: 'Chef Marrow asked about the souffle and the party answered.',
      activeEntityNames: ['Active NPC'],
    });

    expect(result.canonCut).toBe(true);
    expect(result.droppedEntities).toBeGreaterThan(0);
    expect(result.keptEntities).toBeGreaterThan(0);
    expect(result.sectionTokens).toBeLessThanOrEqual(13_000);
    // Active scene entities are always kept, and entities named in recent turns
    // outrank irrelevant ones even from the back of fetch order.
    expect(result.section).toContain('Chef Marrow');
    expect(result.section).toContain('Active NPC');
    // The mandatory blocks survive the cut.
    expect(result.section).toContain('<canonical_setting>');
    expect(result.section).toContain('The Gilded Cauldron');
    expect(result.section).toContain('<creative_direction>');
    expect(result.section).toContain('<lore_adherence>');
    // The surviving entity count is reported honestly.
    expect(result.section).toContain(`<npcs count="${result.keptEntities}">`);
  });

  it('keeps an oversized active-scene entity even when it alone exceeds the entity budget', () => {
    // One active NPC whose block is bigger than the whole entity budget: the
    // guarantee is retention, not the cap — the section may run slightly over.
    const huge = chunk('Colossal Warden', 'W'.repeat(60_000));
    const lore: StarterCampaignLore = {
      ...smallLore,
      rules: [],
      entitiesByType: {
        npcs: [huge],
        locations: [],
        factions: [],
        items: [],
        monsters: [],
        handouts: [],
      },
    };

    const result = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      tokenBudget: 13_000,
      activeEntityNames: ['Colossal Warden'],
    });

    expect(result.keptEntities).toBe(1);
    expect(result.section).toContain('Colossal Warden');
  });

  it('drops asset lines for cut entities but keeps the section shell', () => {
    const lore: StarterCampaignLore = {
      ...smallLore,
      rules: [],
      entitiesByType: {
        npcs: [
          chunk('Kept One', 'Kept in recent turns. ' + 'x'.repeat(2000)),
          chunk('Dropped Two', 'Never mentioned. ' + 'x'.repeat(2000)),
        ],
        locations: [],
        factions: [],
        items: [],
        monsters: [],
        handouts: [],
      },
      assetsSection: `<available_visual_assets>
<MANDATORY_REQUIREMENT>
Include the tags.
</MANDATORY_REQUIREMENT>

- Kept One [ASSET:npc:kept-one]
- Dropped Two [ASSET:npc:dropped-two]
</available_visual_assets>`,
    };

    const result = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      // Fixed head/tail/assets run ~260 tokens; one ~514-token entity fits, two do not.
      tokenBudget: 900,
      recentTurnsText: 'Kept One waved at the party.',
    });

    expect(result.canonCut).toBe(true);
    expect(result.section).toContain('Kept One');
    expect(result.section).not.toContain('Dropped Two');
    expect(result.section).toContain('<available_visual_assets>');
    expect(result.section).toContain('- Kept One [ASSET:npc:kept-one]');
    expect(result.section).not.toContain('- Dropped Two [ASSET:npc:dropped-two]');
  });

  it('keeps non-entity asset lines (character templates, scene art) on a cut turn', () => {
    const lore: StarterCampaignLore = {
      ...smallLore,
      rules: [],
      entitiesByType: {
        npcs: [
          chunk('Kept One', 'Kept in recent turns. ' + 'x'.repeat(2000)),
          chunk('Dropped Two', 'Never mentioned. ' + 'x'.repeat(2000)),
        ],
        locations: [],
        factions: [],
        items: [],
        monsters: [],
        handouts: [],
      },
      assetsSection: `<available_visual_assets>
<MANDATORY_REQUIREMENT>
Include the tags.
</MANDATORY_REQUIREMENT>

- Kept One [ASSET:npc:kept-one]
- Dropped Two [ASSET:npc:dropped-two]
- The Apprentice [ASSET:character:the-apprentice]
- Tavern Interior [ASSET:scene:tavern-interior]
</available_visual_assets>`,
    };

    const result = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      tokenBudget: 900,
      recentTurnsText: 'Kept One waved at the party.',
    });

    expect(result.canonCut).toBe(true);
    // The cut entity's line is gone, but the character template and scene art
    // — never part of the ranked entity set — must survive.
    expect(result.section).not.toContain('- Dropped Two [ASSET:npc:dropped-two]');
    expect(result.section).toContain('- The Apprentice [ASSET:character:the-apprentice]');
    expect(result.section).toContain('- Tavern Interior [ASSET:scene:tavern-interior]');
  });
});

describe('CampaignContextPrompts.extractSceneEntityNames', () => {
  it('parses entity names from a rendered scene_state block', () => {
    const block =
      '<scene_state>\n<entity type="npc" name="Chef Marrow">\n<entity type="location" name="The Grand Kitchen">\n</scene_state>';
    expect(CampaignContextPrompts.extractSceneEntityNames(block)).toEqual([
      'Chef Marrow',
      'The Grand Kitchen',
    ]);
  });

  it('accepts single-quoted name attributes', () => {
    const block = "<scene_state>\n<entity type='npc' name='Chef Marrow'>\n</scene_state>";
    expect(CampaignContextPrompts.extractSceneEntityNames(block)).toEqual(['Chef Marrow']);
  });

  it('parses names containing the opposite quote (apostrophes)', () => {
    // The ledger writes names unescaped; Ma'ren must survive inside double quotes.
    const block =
      '<scene_state>\n<entity type="npc" name="Ma\'ren">\n<entity type=\'npc\' name=\'O"Brien\'>\n</scene_state>';
    expect(CampaignContextPrompts.extractSceneEntityNames(block)).toEqual(["Ma'ren", 'O"Brien']);
  });

  it('returns an empty list for null or entity-less blocks', () => {
    expect(CampaignContextPrompts.extractSceneEntityNames(null)).toEqual([]);
    expect(CampaignContextPrompts.extractSceneEntityNames('<scene_state></scene_state>')).toEqual(
      [],
    );
  });
});

describe('CampaignContextPrompts.renderStarterCampaignLore with a turnScope (#2533)', () => {
  const entity = (
    chunkType: CampaignChunk['chunkType'],
    name: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): CampaignChunk => ({
    id: `chunk-${name}`,
    campaignId: 'campaign-1',
    chunkType,
    entityName: name,
    content,
    metadata,
  });

  const lore: StarterCampaignLore = {
    ...smallLore,
    entitiesByType: {
      npcs: [
        entity('npc_tier1', 'Headmaster Brine', 'Brine runs the kitchen.', {
          image_url: 'https://example.com/brine.png',
        }),
        entity('npc_tier1', 'Sous-Chef Pip', 'Pip is a nervous gnome.'),
        entity('npc_tier1', 'Chef Marrow', 'Marrow is the reclusive head chef.'),
        entity('npc_tier1', 'Dame Quillfeather', 'Quillfeather judges the finals.'),
      ],
      locations: [
        entity('location', 'The Grand Kitchen', 'Copper pots hang above a roaring hearth.'),
        entity('location', 'The Cellar Larder', 'Cold shelves of cured meat.'),
      ],
      factions: [entity('faction', 'Order of the Silver Spoon', 'A guild of judges.')],
      items: [entity('item', 'Golden Ladle', 'A ceremonial ladle.')],
      monsters: [entity('monster', 'Flour Wraith', 'A dusty haunt.', { image_url: 'x' })],
      handouts: [
        entity('handout', 'Menu Card', 'Tonight: souffle.', {
          key: 'menu-card',
          title: 'Menu Card',
          giver: 'Chef Marrow',
        }),
        entity('handout', 'Judge Scorecard', 'Scores for the finals.', {
          key: 'judge-scorecard',
          title: 'Judge Scorecard',
          giver: 'Dame Quillfeather',
        }),
      ],
    },
    assetsSection: `<available_visual_assets>
<MANDATORY_REQUIREMENT>
Include the tags.
</MANDATORY_REQUIREMENT>

- Headmaster Brine [ASSET:npc:headmaster-brine]
- Flour Wraith [ASSET:monster:flour-wraith]
- Wren Ashdown [ASSET:character:wren-ashdown]
</available_visual_assets>`,
  };

  const scope = (over: Partial<TurnCanonScope> = {}): TurnCanonScope => ({
    playerInput: '',
    lastDmMessage: '',
    sceneText: '',
    entityTokenBudget: 3_000,
    ...over,
  });

  const render = (turnScope: TurnCanonScope, activeEntityNames: string[] = []) =>
    CampaignContextPrompts.renderStarterCampaignLore(lore, { turnScope, activeEntityNames });

  it('sends the fixed core and a roster, but no entity card, when nothing is in scene or named', () => {
    const { section, keptEntities, canonCut } = render(scope());

    expect(section).toContain('<canonical_setting>');
    expect(section).toContain('TITLE: The Gilded Cauldron');
    expect(section).toContain('<creative_direction>');
    expect(section).toContain('<world_rules>');
    expect(section).toContain('<lore_adherence>');
    expect(section).not.toContain('<npc ');
    expect(section).not.toContain('<location ');
    expect(keptEntities).toBe(0);
    expect(canonCut).toBe(false);
    expect(section).toContain(
      'NPCs: Headmaster Brine; Sous-Chef Pip; Chef Marrow; Dame Quillfeather',
    );
  });

  it("picks the scene's entities: those in the ledger scene, always", () => {
    const { section } = render(scope(), ['Sous-Chef Pip', 'The Grand Kitchen']);

    expect(section).toContain('<npc name="Sous-Chef Pip">');
    expect(section).toContain('<location name="The Grand Kitchen">');
    expect(section).not.toContain('<npc name="Headmaster Brine"');
    expect(section).not.toContain('<npc name="Chef Marrow"');
    // The rest of the canon is still named, so the DM cannot invent a stand-in.
    expect(section).toContain('Headmaster Brine');
    expect(section).toContain('<canon_roster>');
    expect(section).not.toMatch(/NPCs: [^\n]*Sous-Chef Pip/);
  });

  it('picks entities named in the player input, by full name or by a name token', () => {
    const { section } = render(scope({ playerInput: 'I ask Brine about the Cellar Larder' }));

    expect(section).toContain('<npc name="Headmaster Brine"');
    expect(section).toContain('<location name="The Cellar Larder">');
    expect(section).not.toContain('<npc name="Chef Marrow"');
    expect(section).not.toContain('<location name="The Grand Kitchen">');
  });

  it('picks entities named in the last DM message and in the scene description', () => {
    const { section } = render(
      scope({
        lastDmMessage: 'DM: Chef Marrow glares from behind the pass.',
        sceneText: 'The Grand Kitchen at the dinner rush.',
      }),
    );

    expect(section).toContain('<npc name="Chef Marrow">');
    expect(section).toContain('<location name="The Grand Kitchen">');
    expect(section).not.toContain('<npc name="Dame Quillfeather"');
  });

  it('picks the creatures on the tactical digest, named by id', () => {
    const { section } = render(
      scope({
        sceneText: 'flour-wraith-1|Flour Wraith@4,4 mv30/30 vs[the-seeker:15ft/LoS/c0/melee]',
      }),
    );

    expect(section).toContain('<monster name="Flour Wraith"');
  });

  it('matches whole words only, and never on a bare title', () => {
    const { section } = render(
      scope({
        playerInput: 'I walk past the headmasters and a dame of the court; the pipeline is fine',
      }),
    );

    expect(section).not.toContain('<npc name="Headmaster Brine"');
    expect(section).not.toContain('<npc name="Dame Quillfeather"');
    expect(section).not.toContain('<npc name="Sous-Chef Pip"');
  });

  it('needs the full name or two name tokens for a faction, item or creature', () => {
    const generic = render(scope({ playerInput: 'I grab a spoon and the golden light fades' }));
    expect(generic.section).not.toContain('<faction ');
    expect(generic.section).not.toContain('<item ');

    const named = render(scope({ playerInput: 'I take the Golden Ladle from the Flour Wraith' }));
    expect(named.section).toContain('<item name="Golden Ladle">');
    expect(named.section).toContain('<monster name="Flour Wraith"');
  });

  it('keeps every authored handout deliverable by key, with the body only when it is in play', () => {
    const { section } = render(scope(), ['Chef Marrow']);

    // The giver is in the scene, so the Menu Card arrives in full ...
    expect(section).toContain('<handout key="menu-card" title="Menu Card" giver="Chef Marrow">');
    expect(section).toContain('Tonight: souffle.');
    // ... and the other handout is still listed by its exact key, without its body.
    expect(section).toContain(
      '<handout key="judge-scorecard" title="Judge Scorecard" giver="Dame Quillfeather" />',
    );
    expect(section).not.toContain('Scores for the finals.');
    expect(section).toContain('Deliver authored handouts only through handout_actions');
  });

  it('drops asset lines for entities left out, keeps those for entities sent and the party', () => {
    const { section } = render(scope({ playerInput: 'I greet Headmaster Brine' }));

    expect(section).toContain('- Headmaster Brine [ASSET:npc:headmaster-brine]');
    expect(section).toContain('- Wren Ashdown [ASSET:character:wren-ashdown]');
    expect(section).not.toContain('- Flour Wraith [ASSET:monster:flour-wraith]');
  });

  it('is much smaller than the full render and leaves the whole-bible render alone', () => {
    const whole = CampaignContextPrompts.renderStarterCampaignLore(lore);
    const scoped = render(scope({ playerInput: 'I greet Headmaster Brine' }));

    expect(whole.section).toContain('<npc name="Dame Quillfeather">');
    expect(whole.section).not.toContain('<canon_roster>');
    expect(scoped.sectionTokens).toBeLessThan(whole.sectionTokens);
  });

  it('selects a person by a short name token and a place or faction across apostrophe forms', () => {
    const pip = render(scope({ playerInput: 'I ask Pip', lastDmMessage: 'DM: Pip frowns.' }));
    expect(pip.section).toContain('<npc name="Sous-Chef Pip">');

    const apos: StarterCampaignLore = {
      ...lore,
      entitiesByType: {
        ...lore.entitiesByType,
        factions: [entity('faction', "The Spoon-Bearers' Guild", 'Judges.')],
        items: [entity('item', "Marrow's Ledger", 'A ledger.')],
      },
    };
    const result = CampaignContextPrompts.renderStarterCampaignLore(apos, {
      turnScope: scope({
        playerInput: 'I ask the Spoon-Bearers Guild',
        lastDmMessage: 'DM: Marrow\u2019s Ledger lies open.',
      }),
    });
    expect(result.section).toContain('<faction name="The Spoon-Bearers\' Guild">');
    expect(result.section).toContain('<item name="Marrow\'s Ledger">');
  });

  it('does not charge the scene to the per-turn allowance for named cards', () => {
    const crowd = Array.from({ length: 9 }, (_, i) =>
      entity('npc_tier1', `Scene${i}person`, `Scene ${i}. ` + 'x'.repeat(1_400)),
    );
    const big: StarterCampaignLore = {
      ...lore,
      entitiesByType: { ...lore.entitiesByType, npcs: [...crowd, ...lore.entitiesByType.npcs] },
    };
    const result = CampaignContextPrompts.renderStarterCampaignLore(big, {
      turnScope: scope({ playerInput: 'I turn to Brine', entityTokenBudget: 1_000 }),
      activeEntityNames: crowd.map((npc) => npc.entityName as string),
    });

    // Nine scene cards (~3k tokens) exceed the 1,000-token allowance, yet Brine is still sent.
    expect(result.section).toContain('<npc name="Headmaster Brine"');
    expect(result.canonCut).toBe(false);
  });

  it('flags a cut and keeps the scene when the entities a turn names overflow the entity budget', () => {
    const big: StarterCampaignLore = {
      ...lore,
      entitiesByType: {
        ...lore.entitiesByType,
        npcs: Array.from({ length: 10 }, (_, i) =>
          entity('npc_tier1', `Cook${i}name`, `Cook ${i}. ` + 'x'.repeat(1_600)),
        ),
      },
    };
    const names = Array.from({ length: 10 }, (_, i) => `Cook${i}name`);
    const result = CampaignContextPrompts.renderStarterCampaignLore(big, {
      turnScope: scope({ playerInput: names.join(' '), entityTokenBudget: 1_000 }),
      activeEntityNames: ['Cook9name'],
    });

    expect(result.canonCut).toBe(true);
    expect(result.section).toContain('<npc name="Cook9name">');
    expect(result.keptEntities).toBeLessThan(10);
    expect(result.keptEntities).toBeGreaterThan(1);
  });
});
