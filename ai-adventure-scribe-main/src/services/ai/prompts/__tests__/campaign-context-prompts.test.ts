 
import { describe, it, expect } from 'vitest';

import {
  CampaignContextPrompts,
  type StarterCampaignLore,
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
      chunk('Headmaster Brine', 'A stern halfling who runs the academy kitchen with an iron ladle.', {
        image_url: 'https://example.com/brine.png',
      }),
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
