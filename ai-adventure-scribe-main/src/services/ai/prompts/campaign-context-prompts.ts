/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchCampaignAssetsForPrompt } from '../asset-processor';
import { approximateTokens } from '../shared/token-budget';

import type {
  CampaignChunk,
  CampaignRule,
} from '@/agents/services/lore-keeper/data-mapping';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/** Canonical entity sections, in the order they render in the prompt. */
export type LoreSectionType =
  | 'npcs'
  | 'locations'
  | 'factions'
  | 'items'
  | 'monsters'
  | 'handouts';

/** Starter campaign lore fetched from the server, before rendering. */
export interface StarterCampaignLore {
  title: string;
  premise: string;
  creativeBrief: string;
  overviewText: string;
  rules: CampaignRule[];
  entitiesByType: Record<LoreSectionType, CampaignChunk[]>;
  /** Rendered `<available_visual_assets>` section ('' when the campaign has none). */
  assetsSection: string;
}

export interface LoreRenderOptions {
  /**
   * Max tokens for the whole lore section. When undefined the section renders
   * uncapped, byte-identical to the pre-budget behavior.
   */
  tokenBudget?: number;
  /** Recent turns, rendered as plain text, used to rank entities by relevance. */
  recentTurnsText?: string;
  /** Entity names present in the current scene (from `<scene_state>`) — always kept. */
  activeEntityNames?: string[];
}

export interface LoreRenderResult {
  section: string;
  sectionTokens: number;
  /** True when any rankable entity content was dropped to fit the budget. */
  canonCut: boolean;
  keptEntities: number;
  droppedEntities: number;
}

const LORE_SECTION_ORDER: LoreSectionType[] = [
  'npcs',
  'locations',
  'factions',
  'items',
  'monsters',
  'handouts',
];

const RELEVANCE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'with',
  'from',
  'that',
  'this',
  'these',
  'those',
  'they',
  'them',
  'their',
  'there',
  'here',
  'when',
  'where',
  'what',
  'which',
  'into',
  'through',
  'during',
  'after',
  'before',
  'about',
  'have',
  'has',
  'had',
  'were',
  'was',
  'are',
  'for',
  'you',
  'your',
  'will',
  'would',
  'could',
  'should',
  'said',
  'says',
]);

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z]{5,}/g) || [];
}

/**
 * Relevance score for one entity block. Active scene entities always win;
 * then entities named in recent turns; then keyword overlap with recent turns.
 * Deterministic: ties keep fetch order.
 */
function scoreEntity(
  entity: CampaignChunk,
  recentLower: string,
  recentWords: Set<string>,
  activeNames: Set<string>,
): number {
  let score = 0;
  const nameLower = (entity.entityName || '').toLowerCase();
  if (nameLower && activeNames.has(nameLower)) score += 1_000_000;
  if (nameLower.length >= 3 && recentLower.includes(nameLower)) score += 1_000;
  let overlap = 0;
  for (const word of wordsOf(`${entity.entityName || ''} ${entity.content || ''}`)) {
    if (!RELEVANCE_STOPWORDS.has(word) && recentWords.has(word)) overlap += 1;
  }
  score += Math.min(overlap, 50);
  return score;
}

function renderLoreHead(lore: StarterCampaignLore): string {
  let head = `
<starter_campaign_lore>
<canonical_setting>
TITLE: ${lore.title}
PREMISE: ${lore.premise}
OVERVIEW: ${lore.overviewText}
</canonical_setting>

<creative_direction>
${lore.creativeBrief}
</creative_direction>`;

  if (lore.rules.length > 0) {
    head += `
<world_rules>
These rules govern how the world responds to player actions:
${lore.rules
  .map(
    (rule) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`,
  )
  .join('\n')}
</world_rules>`;
  }
  return head;
}

function renderLoreTail(): string {
  return `

<lore_adherence>
- USE the canonical NPCs listed above - do NOT invent new characters when these exist
- When introducing an NPC from the list, use their EXACT name
- Reference canonical locations and describe them as specified
- Apply world rules consistently
- **CRITICAL: Include the asset_tag shown for any entity with a portrait/image when you first mention them**
- Asset tags like [ASSET:npc:headmaster] display the entity's artwork to the player
</lore_adherence>
</starter_campaign_lore>`;
}

function renderEntityBlock(sectionType: LoreSectionType, entity: CampaignChunk): string {
  const name = entity.entityName || '';
  const content = entity.content || '';
  switch (sectionType) {
    case 'npcs': {
      const hasImage = !!(entity.metadata as any)?.image_url;
      const assetKey = name.toLowerCase().replace(/\s+/g, '-') || '';
      const assetTag = hasImage ? `[ASSET:npc:${assetKey}]` : '';
      return `<npc name="${name}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${content}${hasImage ? `\n**VISUAL: Use ${assetTag} when introducing this character**` : ''}
</npc>`;
    }
    case 'locations': {
      const hasImage = !!(entity.metadata as any)?.image_url;
      const assetKey = name.toLowerCase().replace(/\s+/g, '-') || '';
      const assetTag = hasImage ? `[ASSET:location:${assetKey}]` : '';
      return `<location name="${name}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${content}${hasImage ? `\n**VISUAL: Use ${assetTag} when the party enters or views this location**` : ''}
</location>`;
    }
    case 'factions':
      return `<faction name="${name}">
${content}
</faction>`;
    case 'items':
      return `<item name="${name}">
${content}
</item>`;
    case 'monsters': {
      const hasImage = !!(entity.metadata as any)?.image_url;
      const assetKey = name.toLowerCase().replace(/\s+/g, '-') || '';
      const assetTag = hasImage ? `[ASSET:monster:${assetKey}]` : '';
      return `<monster name="${name}"${hasImage ? ` asset_tag="${assetTag}"` : ''}>
${content}${hasImage ? `\n**VISUAL: Use ${assetTag} when this creature appears or attacks**` : ''}
</monster>`;
    }
    case 'handouts': {
      const metadata = (entity.metadata as any) || {};
      return `<handout key="${metadata.key || ''}" title="${metadata.title || name || ''}" giver="${metadata.giver || ''}">
${content}
</handout>`;
    }
  }
}

function renderEntityTypeSection(
  sectionType: LoreSectionType,
  entities: CampaignChunk[],
): string {
  if (entities.length === 0) return '';
  const blocks = entities.map((entity) => renderEntityBlock(sectionType, entity)).join('\n');
  switch (sectionType) {
    case 'npcs':
      return `

<npcs count="${entities.length}">
${blocks}
</npcs>`;
    case 'locations':
      return `

<locations count="${entities.length}">
${blocks}
</locations>`;
    case 'factions':
      return `

<factions count="${entities.length}">
${blocks}
</factions>`;
    case 'items':
      return `

<items count="${entities.length}">
${blocks}
</items>`;
    case 'monsters':
      return `

<monsters count="${entities.length}">
${blocks}
</monsters>`;
    case 'handouts':
      return `

<available_handouts>
<instruction>Deliver authored handouts only through handout_actions using the exact key. The server validates every key.</instruction>
${blocks}
</available_handouts>`;
  }
}

/**
 * Drop asset list lines for entities that were cut from canon. The asset
 * section lists `- Name [ASSET:type:key]` lines; header/footer lines stay.
 * Crucially, this drops by *dropped* entity names, not by kept names: the
 * assets section also carries non-entity lines (premade character templates,
 * scene assets) whose names never appear in the ranked entity set, and those
 * must always survive a cut — otherwise the DM loses the portrait-tag
 * instructions for the player's own character on exactly the heavy turns.
 */
function filterAssetsSection(assetsSection: string, droppedNames: Set<string>): string {
  if (!assetsSection) return assetsSection;
  const lines = assetsSection.split('\n').filter((line) => {
    const match = /^- (.+) \[ASSET:[^\]]+\]$/.exec(line.trim());
    if (!match) return true;
    return !droppedNames.has(match[1].toLowerCase());
  });
  return lines.join('\n');
}

/**
 * CampaignContextPrompts - Handles building starter campaign lore and canonical entities sections of the prompt.
 * Extracted from game-context-prompts.ts
 */
export class CampaignContextPrompts {
  /**
   * Fetch starter campaign lore without rendering it, so callers can render
   * with a token budget (relevance-ranked, capped) and measure the result.
   * Returns null when the campaign has no lore content or the fetch fails.
   */
  public static async fetchStarterCampaignLore(
    starterCampaignId: string,
  ): Promise<StarterCampaignLore | null> {
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
        return null;
      }

      const overview = campaignOverview as unknown as Record<string, unknown>;
      const entitiesByType: Record<LoreSectionType, CampaignChunk[]> = {
        npcs: campaignEntities?.npcs ?? [],
        locations: campaignEntities?.locations ?? [],
        factions: campaignEntities?.factions ?? [],
        items: campaignEntities?.items ?? [],
        monsters: campaignEntities?.monsters ?? [],
        handouts: campaignEntities?.handouts ?? [],
      };

      return {
        title: (overview.title || overview.name || 'Unnamed Starter Campaign') as string,
        premise: (overview.premise ||
          overview.description ||
          'A mysterious adventure awaits.') as string,
        creativeBrief: (overview.creativeBrief ||
          overview.creative_brief ||
          'Maintain an immersive, atmospheric tone.') as string,
        overviewText: (overview.overview || overview.setting_details || '') as string,
        rules: campaignRules || [],
        entitiesByType,
        assetsSection: campaignAssets || '',
      };
    } catch (loreError) {
      logger.warn('[ContextBuilder] Failed to fetch starter campaign lore:', loreError);
      // Loud, not just logged (#1680): a failed lore fetch previously only warned to a log
      // nobody watches. `buildStarterCampaignLoreSection` isn't passed a sessionId, so this
      // reports without one — the server route and `alert()` both treat it as optional.
      userDataApi.reportClientFailure('lore_injection_failed', undefined, String(loreError));
      return null;
    }
  }

  /**
   * Render the starter campaign lore section, capping rankable entity content
   * to `options.tokenBudget`. The overview, creative direction, world rules,
   * and adherence instructions are always kept; entities named in
   * `activeEntityNames` (the current scene) are kept next; the rest are ranked
   * by relevance to `recentTurnsText` and dropped cheapest-first until the
   * budget fits. With no `tokenBudget` (or when everything fits) the output is
   * byte-identical to the pre-budget render.
   */
  public static renderStarterCampaignLore(
    lore: StarterCampaignLore,
    options: LoreRenderOptions = {},
  ): LoreRenderResult {
    const head = renderLoreHead(lore);
    const tail = renderLoreTail();

    const units: { entity: CampaignChunk; sectionType: LoreSectionType; order: number }[] =
      [];
    for (const sectionType of LORE_SECTION_ORDER) {
      for (const entity of lore.entitiesByType[sectionType]) {
        units.push({ entity, sectionType, order: units.length });
      }
    }

    let kept = units;
    let canonCut = false;
    if (options.tokenBudget !== undefined) {
      const recentLower = (options.recentTurnsText || '').toLowerCase();
      const recentWords = new Set(wordsOf(options.recentTurnsText || ''));
      const activeNames = new Set(
        (options.activeEntityNames || []).map((name) => name.toLowerCase()),
      );
      const scored = units.map((unit) => ({
        ...unit,
        score: scoreEntity(unit.entity, recentLower, recentWords, activeNames),
      }));
      scored.sort((a, b) => b.score - a.score || a.order - b.order);
      const headTokens = approximateTokens(head + tail + lore.assetsSection);
      // Wrapper overhead the greedy fill must leave room for: the
      // `<canonical_entities>` opener/instruction/closer plus the per-type
      // `<npcs count="N">` wrappers. Unbudgeted, the final section can exceed
      // tokenBudget by ~90 tokens on wrapper-heavy campaigns.
      const WRAPPER_TOKEN_ALLOWANCE = 100;
      let remaining = Math.max(0, options.tokenBudget - headTokens - WRAPPER_TOKEN_ALLOWANCE);
      kept = [];
      // Active scene entities are always kept (#2450): reserve them before the
      // greedy fill, in fetch order. Their cost comes out of the entity budget
      // first; anything left goes to relevance-ranked entities.
      const isActive = (unit: (typeof scored)[number]): boolean =>
        activeNames.has((unit.entity.entityName || '').toLowerCase());
      for (const unit of scored.filter(isActive)) {
        kept.push(unit);
        remaining = Math.max(
          0,
          remaining - approximateTokens(renderEntityBlock(unit.sectionType, unit.entity)),
        );
      }
      for (const unit of scored.filter((unit) => !isActive(unit))) {
        const cost = approximateTokens(renderEntityBlock(unit.sectionType, unit.entity));
        if (cost <= remaining) {
          kept.push(unit);
          remaining -= cost;
        }
      }
      // Restore canonical section order for rendering; relevance order only
      // decided which entities survived.
      kept.sort((a, b) => a.order - b.order);
      canonCut = kept.length < units.length;
    }

    let entitiesSection = '';
    if (kept.length > 0) {
      entitiesSection = `

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>`;
      for (const sectionType of LORE_SECTION_ORDER) {
        entitiesSection += renderEntityTypeSection(
          sectionType,
          kept.filter((unit) => unit.sectionType === sectionType).map((unit) => unit.entity),
        );
      }
      entitiesSection += `
</canonical_entities>`;
    }

    const keptNames = new Set(
      kept.map((unit) => (unit.entity.entityName || '').toLowerCase()),
    );
    const droppedNames = new Set(
      units
        .filter((unit) => !keptNames.has((unit.entity.entityName || '').toLowerCase()))
        .map((unit) => (unit.entity.entityName || '').toLowerCase()),
    );
    const assetsSection = canonCut
      ? filterAssetsSection(lore.assetsSection, droppedNames)
      : lore.assetsSection;

    const section = head + entitiesSection + tail + assetsSection;
    const sectionTokens = approximateTokens(section);
    return {
      section,
      sectionTokens,
      canonCut,
      keptEntities: kept.length,
      droppedEntities: units.length - kept.length,
    };
  }

  public static async buildStarterCampaignLoreSection(
    starterCampaignId: string,
    options: LoreRenderOptions = {},
  ): Promise<string> {
    const lore = await CampaignContextPrompts.fetchStarterCampaignLore(starterCampaignId);
    if (!lore) {
      return '';
    }
    return CampaignContextPrompts.renderStarterCampaignLore(lore, options).section;
  }

  /**
   * Entity names present in the current scene, parsed from a rendered
   * `<scene_state>` block's `<entity type="..." name="...">` tags.
   * Accepts either quote style; the server renderer is the authority and this
   * must not silently miss entities over a quoting choice.
   */
  public static extractSceneEntityNames(sceneStateBlock: string | null): string[] {
    if (!sceneStateBlock) return [];
    const names = new Set<string>();
    // #2450: match names containing the opposite quote (e.g. name="Ma'ren").
    // The tempered pattern ((?:(?!\1).)+) consumes any char that isn't the opening quote.
    const pattern = /<entity\b[^>]*\bname=(["'])((?:(?!\1).)+)\1/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sceneStateBlock)) !== null) {
      names.add(match[2]);
    }
    return [...names];
  }
}
