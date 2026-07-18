/* eslint-disable @typescript-eslint/no-explicit-any */
import { getCharacterPassiveScores } from '../../passive-skills-service';
import { fetchCampaignAssetsForPrompt } from '../asset-processor';
import { getClassEquipment } from '../class-equipment';

import type { Memory } from '../../memory-manager';
import type { GameContext } from '../shared/types';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import logger from '@/lib/logger';
import { convertCharacterDetailsToCharacter } from '@/utils/character-converter';

/**
 * GameContextPrompts - Handles building the game context and character sections of the prompt
 * Extracted from ContextBuilderPrompts.ts
 */
export class GameContextPrompts {
  static async buildGameContextSection(
    context: GameContext,
    relevantMemories: Memory[],
  ): Promise<string> {
    let section = `<game_context>`;
    const rawCampaignDetails = context.campaignDetails || {};
    const nestedCampaignDetails =
      (rawCampaignDetails.campaign as Record<string, unknown> | undefined) ||
      (rawCampaignDetails.basic as Record<string, unknown> | undefined) ||
      rawCampaignDetails;
    const campaignName =
      nestedCampaignDetails.name || nestedCampaignDetails.title || 'Unnamed Campaign';
    const campaignDescription =
      nestedCampaignDetails.description || nestedCampaignDetails.premise || '';

    if (context.campaignDetails) {
      section += `<campaign_details>
CAMPAIGN: "${campaignName}"
DESCRIPTION: ${campaignDescription}
</campaign_details>`;
    }

    // Lore handling (Async)
    let starterCampaignId =
      context.starterCampaignId ||
      (rawCampaignDetails.starter_campaign_id as string | undefined) ||
      (rawCampaignDetails.starterCampaignId as string | undefined);

    // Fallback: if no starterCampaignId but campaign name matches a starter campaign
    if (!starterCampaignId && campaignName) {
      const normalizedCampaignName = String(campaignName).toLowerCase().trim();
      const nameToSlug: Record<string, string> = {
        'the eternal feast': 'the-eternal-feast',
        'eternal feast': 'the-eternal-feast',
        'abyssal descent': 'abyssal-descent',
        'academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
        'the academy of arcane gastronomy': 'academy-of-arcane-gastronomy',
      };
      starterCampaignId = nameToSlug[normalizedCampaignName];
      if (starterCampaignId) {
        logger.info(
          `[ContextBuilder] Inferred starter campaign '${starterCampaignId}' from campaign name`,
        );
      }
    }

    if (starterCampaignId) {
      try {
        const loreKeeper = getLoreKeeperService();
        const [campaignOverview, campaignRules, campaignAssets, campaignEntities] =
          await Promise.all([
            loreKeeper.getCampaignOverview(starterCampaignId),
            loreKeeper.getRules(starterCampaignId),
            fetchCampaignAssetsForPrompt(starterCampaignId),
            loreKeeper.getEntities(starterCampaignId),
          ]);

        if (campaignOverview) {
          const overview = campaignOverview as unknown as Record<string, unknown>;
          const overviewTitle = overview.title || overview.name || 'Unnamed Starter Campaign';
          const premise =
            overview.premise || overview.description || 'A mysterious adventure awaits.';
          const creativeBrief =
            overview.creativeBrief ||
            overview.creative_brief ||
            'Maintain an immersive, atmospheric tone.';
          const campaignOverviewText = overview.overview || overview.setting_details || '';
          section += `
<starter_campaign_lore>
<canonical_setting>
TITLE: ${overviewTitle}
PREMISE: ${premise}
OVERVIEW: ${campaignOverviewText}
</canonical_setting>

<creative_direction>
${creativeBrief}
</creative_direction>`;

          if (campaignRules && campaignRules.length > 0) {
            section += `
<world_rules>
These rules govern how the world responds to player actions:
${campaignRules.map((rule: any) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`).join('\n')}
</world_rules>`;
          }

          const {
            npcs = [],
            locations = [],
            factions = [],
            items = [],
            monsters = [],
            handouts = [],
          } = campaignEntities || {};
          const totalEntities =
            npcs.length +
            locations.length +
            factions.length +
            items.length +
            monsters.length +
            handouts.length;

          if (totalEntities > 0) {
            section += `

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>`;

            if (npcs.length > 0) {
              section += `

<npcs count="${npcs.length}">
${npcs
  .map((npc: any) => {
    const hasImage = !!npc.metadata?.image_url;
    const assetKey = npc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:npc:${assetKey}]` : '';
    return `<npc name="${npc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${npc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when introducing this character**` : ''}
</npc>`;
  })
  .join('\n')}
</npcs>`;
            }

            if (locations.length > 0) {
              section += `

<locations count="${locations.length}">
${locations
  .map((loc: any) => {
    const hasImage = !!loc.metadata?.image_url;
    const assetKey = loc.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:location:${assetKey}]` : '';
    return `<location name="${loc.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${loc.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when the party enters or views this location**` : ''}
</location>`;
  })
  .join('\n')}
</locations>`;
            }

            if (factions.length > 0) {
              section += `

<factions count="${factions.length}">
${factions
  .map(
    (f: any) => `<faction name="${f.entityName}">
${f.content}
</faction>`,
  )
  .join('\n')}
</factions>`;
            }

            if (items.length > 0) {
              section += `

<items count="${items.length}">
${items
  .map(
    (item: any) => `<item name="${item.entityName}">
${item.content}
</item>`,
  )
  .join('\n')}
</items>`;
            }

            if (monsters.length > 0) {
              section += `

<monsters count="${monsters.length}">
${monsters
  .map((m: any) => {
    const hasImage = !!m.metadata?.image_url;
    const assetKey = m.entityName?.toLowerCase().replace(/\s+/g, '-') || '';
    const assetTag = hasImage ? `[ASSET:monster:${assetKey}]` : '';
    return `<monster name="${m.entityName}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${m.content}${hasImage ? `\n**VISUAL: Use ${assetTag} when this creature appears or attacks**` : ''}
</monster>`;
  })
  .join('\n')}
</monsters>`;
            }

            if (handouts.length > 0) {
              section += `

<available_handouts>
<instruction>Deliver authored handouts only through handout_actions using the exact key. The server validates every key.</instruction>
${handouts
  .map(
    (
      handout: any,
    ) => `<handout key="${handout.metadata?.key || ''}" title="${handout.metadata?.title || handout.entityName || ''}" giver="${handout.metadata?.giver || ''}">
${handout.content}
</handout>`,
  )
  .join('\n')}
</available_handouts>`;
            }

            section += `
</canonical_entities>`;
          }

          section += `

<lore_adherence>
- USE the canonical NPCs listed above - do NOT invent new characters when these exist
- When introducing an NPC from the list, use their EXACT name
- Reference canonical locations and describe them as specified
- Apply world rules consistently
- **CRITICAL: Include the asset_tag shown for any entity with a portrait/image when you first mention them**
- Asset tags like [ASSET:npc:headmaster] display the entity's artwork to the player
</lore_adherence>
</starter_campaign_lore>`;

          if (campaignAssets) {
            section += campaignAssets;
          }
        }
      } catch (loreError) {
        logger.warn('[ContextBuilder] Failed to fetch starter campaign lore:', loreError);
      }
    }

    if (context.characterDetails) {
      section += GameContextPrompts.buildCharacterSection(context.characterDetails);
    }

    if (relevantMemories.length > 0) {
      section += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.`;
      relevantMemories.forEach((memory, index) => {
        section += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
      });
      section += `
</story_memories>`;
    }

    section += `</game_context>`;
    return section;
  }

  static buildCharacterSection(char: Record<string, any>): string {
    let section = `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class?.name || char.class || 'Unknown Class'}`;

    if (char.background) {
      section += ` (${char.background} background)`;
    }

    if (char.character_stats && char.character_stats.length > 0) {
      const stats = char.character_stats[0];
      const calcMod = (score: number = 10): string => {
        const mod = Math.floor((score - 10) / 2);
        return mod >= 0 ? `+${mod}` : `${mod}`;
      };

      section += `
<ability_scores>
STR ${stats.strength}(${calcMod(stats.strength)}), DEX ${stats.dexterity}(${calcMod(stats.dexterity)}), CON ${stats.constitution}(${calcMod(stats.constitution)}), INT ${stats.intelligence}(${calcMod(stats.intelligence)}), WIS ${stats.wisdom}(${calcMod(stats.wisdom)}), CHA ${stats.charisma}(${calcMod(stats.charisma)})
</ability_scores>`;

      const profBonus =
        char.level >= 17 ? 6 : char.level >= 13 ? 5 : char.level >= 9 ? 4 : char.level >= 5 ? 3 : 2;
      section += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
    }

    const className = char.class?.name || char.class;
    const classEquipment = getClassEquipment(className || 'Fighter');
    section += `
<equipment>
${classEquipment.weapons.join(', ')} | ${classEquipment.armor}
**CRITICAL: USE EXACT WEAPON DICE from equipment list above for damage roll requests!**
</equipment>`;

    try {
      const characterForPassive = convertCharacterDetailsToCharacter(char as any);
      const passiveScores = getCharacterPassiveScores(characterForPassive);
      section += `

<passive_skills>
**D&D 5E PASSIVE SKILLS (Automatic Checks)**
Passive Perception: ${passiveScores.perception} (notices hidden objects, creatures, traps without rolling)
Passive Insight: ${passiveScores.insight} (senses deception, motives, emotional states automatically)
Passive Investigation: ${passiveScores.investigation} (spots clues, patterns, logical inconsistencies passively)

**DM GUIDANCE: Use these passive scores to proactively reveal information:**
- If a scene has hidden elements with DC ≤ passive score, reveal them automatically
- Example: "Your keen awareness (Passive Perception ${passiveScores.perception}) notices subtle scuff marks on the floor"
- Reserve active checks (d20 rolls) for deliberate investigation or difficult perception tasks
</passive_skills>`;
    } catch (passiveSkillError) {
      logger.warn(
        `[ContextBuilder] Failed to calculate passive skills for character ${char.name} (non-fatal):`,
        passiveSkillError,
      );
    }

    section += `
</character_details>`;
    return section;
  }
}
