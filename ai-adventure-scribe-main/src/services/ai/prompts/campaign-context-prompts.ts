/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchCampaignAssetsForPrompt } from '../asset-processor';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * CampaignContextPrompts - Handles building starter campaign lore and canonical entities sections of the prompt.
 * Extracted from game-context-prompts.ts
 */
export class CampaignContextPrompts {
  public static async buildStarterCampaignLoreSection(starterCampaignId: string): Promise<string> {
    try {
      const loreKeeper = getLoreKeeperService();
      const [campaignOverview, campaignRules, campaignAssets, campaignEntities] =
        await Promise.all([
          loreKeeper.getCampaignOverview(starterCampaignId),
          loreKeeper.getRules(starterCampaignId),
          fetchCampaignAssetsForPrompt(starterCampaignId),
          loreKeeper.getEntities(starterCampaignId),
        ]);

      if (!campaignOverview) {
        return '';
      }

      let section = '';
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
${campaignRules
  .map(
    (rule: any) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`,
  )
  .join('\n')}
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

      return section;
    } catch (loreError) {
      logger.warn('[ContextBuilder] Failed to fetch starter campaign lore:', loreError);
      // Loud, not just logged (#1680): a failed lore fetch previously only warned to a log
      // nobody watches. `buildStarterCampaignLoreSection` isn't passed a sessionId, so this
      // reports without one — the server route and `alert()` both treat it as optional.
      userDataApi.reportClientFailure('lore_injection_failed', undefined, String(loreError));
      return '';
    }
  }
}
