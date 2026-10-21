/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchCampaignAssetsForPrompt, normalizePcName } from '../asset-processor';
import { approximateTokens } from '../shared/token-budget';

import type { CampaignChunk, CampaignRule } from '@/agents/services/lore-keeper/data-mapping';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/** Canonical entity sections, in the order they render in the prompt. */
export type LoreSectionType = 'npcs' | 'locations' | 'factions' | 'items' | 'monsters' | 'handouts';

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
  /**
   * #708: the player's own character name, when this lore was fetched for a
   * premade playthrough. The renderer keeps a same-named NPC chunk out of the
   * NPC cards and the canon roster, so the PC is never presented as a
   * separate scene person.
   */
  playerCharacterName?: string;
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
  /**
   * #2533: render canon for THIS turn instead of the whole bible. The fixed core
   * (setting, creative direction, world rules, adherence) is always sent; entity
   * cards are sent only for entities in `activeEntityNames` and for entities named
   * in the turn text; every other entity is listed by name in `<canon_roster>`.
   * Which entities exist is unchanged: LoreKeeper stays the source of every card.
   */
  turnScope?: TurnCanonScope;
  /**
   * #352: entity names (lower-cased) to leave out of this render. The
   * per-turn input-matched tail block passes the scene section's kept names so
   * it only carries entities the scene section does not already have.
   */
  excludeEntityNames?: string[];
  /**
   * #352: list the entities this render did not keep, by name, even without a
   * turnScope. The scene-stable section uses this so the DM always sees the
   * full canon name roster.
   */
  includeRoster?: boolean;
  /**
   * #352: return only the `<canonical_entities>` block (cards + roster), no
   * setting head, adherence tail or assets. For the small per-turn
   * input-matched tail block.
   */
  entitiesOnly?: boolean;
  /**
   * #352: keep only the scene's entities (plus their handouts) and roster the
   * rest — skip the relevance-ranked fill. For the scene-stable lore section,
   * which must stay small and byte-stable per scene.
   */
  sceneOnly?: boolean;
}

/**
 * What this turn names, in descending weight: the player's input, the last DM message, and the
 * scene (the current scene description and, in combat, the tactical digest).
 */
export interface TurnCanonScope {
  playerInput: string;
  lastDmMessage: string;
  sceneText: string;
  /** Token cap for the entity cards chosen by name (scene-active entities are not charged to it). */
  entityTokenBudget: number;
}

export interface LoreRenderResult {
  section: string;
  sectionTokens: number;
  /** True when any rankable entity content was dropped to fit the budget. */
  canonCut: boolean;
  keptEntities: number;
  droppedEntities: number;
  /** #352: lower-cased names of the entities whose cards this section kept. */
  keptEntityNames: string[];
}

// Wrapper overhead the greedy fill must leave room for: the
// `<canonical_entities>` opener/instruction/closer plus the per-type
// `<npcs count="N">` wrappers. Unbudgeted, the final section can exceed
// tokenBudget by ~90 tokens on wrapper-heavy campaigns.
const WRAPPER_TOKEN_ALLOWANCE = 100;

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

/** Words that must not select an entity on their own: function words and bare titles. */
const NAME_TOKEN_STOPWORDS = new Set([
  'the',
  'of',
  'and',
  'from',
  'with',
  'that',
  'this',
  'into',
  'captain',
  'warden',
  'brother',
  'sister',
  'madam',
  'magistrate',
  'lord',
  'lady',
  'master',
  'doctor',
  'old',
  'new',
  'sir',
  'von',
  'van',
  'dame',
  'baron',
  'duke',
  'king',
  'queen',
  'father',
  'mother',
  'chief',
  'elder',
]);

/**
 * People and places are referred to by part of their name ("Brine", "the chapel"), so one name
 * token selects them. Everything else (factions, items, creatures) is named by common words
 * ("order", "flame", "ghoul" in a sentence about something else), so it needs the full name or
 * two of its name tokens.
 */
const SINGLE_TOKEN_SECTIONS = new Set<LoreSectionType>(['npcs', 'locations']);

const isWordChar = (char: string | undefined): boolean => !!char && /[a-z0-9]/.test(char);

/** Whole-word, case-insensitive containment; linear, no regex built from campaign text. */
function containsWord(textLower: string, wordLower: string): boolean {
  if (!wordLower) return false;
  let from = 0;
  for (;;) {
    const at = textLower.indexOf(wordLower, from);
    if (at === -1) return false;
    if (!isWordChar(textLower[at - 1]) && !isWordChar(textLower[at + wordLower.length]))
      return true;
    from = at + 1;
  }
}

/** Lower-case, one apostrophe form, no possessive: "Marrek’s" and "Lamplighters'" fold to bare words. */
function foldName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/'s\b/g, '')
    .replace(/'/g, '');
}

/** How strongly `textFolded` names the entity: a full-name mention outweighs name tokens. */
function mentionScore(
  entityName: string,
  sectionType: LoreSectionType,
  textFolded: string,
): number {
  const nameFolded = foldName(entityName).trim();
  if (nameFolded.length < 3 || !textFolded) return 0;
  if (containsWord(textFolded, nameFolded)) return 10;
  // A short name ("Pip") is a name token for a person; elsewhere three letters is a common word.
  const minToken = sectionType === 'npcs' ? 3 : 4;
  let tokens = 0;
  for (const token of nameFolded.split(/[^a-z0-9]+/)) {
    if (
      token.length >= minToken &&
      !NAME_TOKEN_STOPWORDS.has(token) &&
      containsWord(textFolded, token)
    ) {
      tokens += 1;
    }
  }
  return SINGLE_TOKEN_SECTIONS.has(sectionType) || tokens >= 2 ? tokens : 0;
}

function turnMentionScore(
  entityName: string,
  sectionType: LoreSectionType,
  scope: TurnCanonScope,
): number {
  return (
    4 * mentionScore(entityName, sectionType, foldName(scope.playerInput)) +
    2 * mentionScore(entityName, sectionType, foldName(scope.lastDmMessage)) +
    mentionScore(entityName, sectionType, foldName(scope.sceneText))
  );
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

/**
 * #708: the identity anchor for premade playthroughs, stated as a canon fact
 * at the head of the lore the DM treats as canonical. Premade names are bare
 * role titles ("The Apprentice") that read as NPC descriptors; without this,
 * the DM narrates the PC in the third person as a separate person in the
 * scene ("Nearby, The Apprentice ..."). It lives here, not in the character
 * block, because the prompt-section counter buckets the character block into
 * system_rules, whose #2533 budget is frozen with only a few tokens of
 * headroom (ai-service-prompt-diet.test.ts), while the lore head is campaign
 * canon with room. Returns '' when the lore carries no player name, so
 * renders without one stay byte-identical.
 */
function playerIdentityBlock(playerCharacterName?: string): string {
  const playerName = playerCharacterName?.trim();
  if (!playerName) return '';
  return `
<player_identity>
${playerName} is the player — the person whose messages you are answering. In scene narration ${playerName} is "you": write what they perceive and do in the second person. Never narrate ${playerName} in the third person by name as a separate person present in the scene (never "Nearby, ${playerName} ...").
</player_identity>
`;
}

function renderLoreHead(lore: StarterCampaignLore): string {
  let head = `
<starter_campaign_lore>
<canonical_setting>
TITLE: ${lore.title}
PREMISE: ${lore.premise}
OVERVIEW: ${lore.overviewText}
</canonical_setting>
${playerIdentityBlock(lore.playerCharacterName)}
<creative_direction>
${lore.creativeBrief}
</creative_direction>`;

  if (lore.rules.length > 0) {
    head += `
<world_rules>
These rules govern how the world responds to player actions:
${lore.rules
  .map((rule) => `- ${rule.condition} → ${rule.effect}${rule.reversible ? ' (reversible)' : ''}`)
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

function renderHandoutIndexLine(entity: CampaignChunk): string {
  const metadata = (entity.metadata as any) || {};
  return `<handout key="${metadata.key || ''}" title="${metadata.title || entity.entityName || ''}" giver="${metadata.giver || ''}" />`;
}

/**
 * `indexOnly` (handouts only, #2533): authored handouts not selected for this turn stay
 * deliverable by exact key, as one line each without the body.
 */
function renderEntityTypeSection(
  sectionType: LoreSectionType,
  entities: CampaignChunk[],
  indexOnly: CampaignChunk[] = [],
): string {
  if (entities.length === 0 && !(sectionType === 'handouts' && indexOnly.length > 0)) return '';
  const blocks = [
    ...entities.map((entity) => renderEntityBlock(sectionType, entity)),
    ...(sectionType === 'handouts' ? indexOnly.map(renderHandoutIndexLine) : []),
  ].join('\n');
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

const ROSTER_LABEL: Record<Exclude<LoreSectionType, 'handouts'>, string> = {
  npcs: 'NPCs',
  locations: 'Locations',
  factions: 'Factions',
  items: 'Items',
  monsters: 'Creatures',
};

function renderCanonRoster(
  left: { entity: CampaignChunk; sectionType: LoreSectionType }[],
): string {
  const lines: string[] = [];
  for (const sectionType of LORE_SECTION_ORDER) {
    if (sectionType === 'handouts') continue;
    const names = left
      .filter((unit) => unit.sectionType === sectionType)
      .map((unit) => unit.entity.entityName || '')
      .filter(Boolean);
    if (names.length > 0) lines.push(`${ROSTER_LABEL[sectionType]}: ${names.join('; ')}`);
  }
  if (lines.length === 0) return '';
  return `

<canon_roster>
<instruction>The rest of this campaign's canon, by name. Each one's full card is supplied on the turns it is in the scene or is named by the player or the previous DM message. Until then use these exact names and do not invent a stand-in for any of them.</instruction>
${lines.join('\n')}
</canon_roster>`;
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
   *
   * #708: `playerCharacterName` marks the player's own premade template in
   * the assets section so the DM does not introduce them as a separate NPC.
   */
  public static async fetchStarterCampaignLore(
    starterCampaignId: string,
    playerCharacterName?: string,
  ): Promise<StarterCampaignLore | null> {
    try {
      const loreKeeper = getLoreKeeperService();
      const [campaignOverview, campaignRules, campaignAssets, campaignEntities] = await Promise.all(
        [
          loreKeeper.getCampaignOverview(starterCampaignId),
          loreKeeper.getRules(starterCampaignId),
          fetchCampaignAssetsForPrompt(starterCampaignId, playerCharacterName),
          loreKeeper.getEntities(starterCampaignId),
        ],
      );

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
        playerCharacterName,
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

    const units: { entity: CampaignChunk; sectionType: LoreSectionType; order: number }[] = [];
    // #352: entities already carried by the scene-stable section are left out
    // of the per-turn tail render.
    const excludedNames = new Set(
      (options.excludeEntityNames || []).map((name) => name.toLowerCase()),
    );
    // #708: the player's own premade is not an NPC. If the campaign bible also
    // authors them as an NPC chunk, that chunk never becomes a card or a
    // roster entry — the character block presents them as the player.
    const playerCharacterFolded = lore.playerCharacterName
      ? normalizePcName(lore.playerCharacterName)
      : '';
    for (const sectionType of LORE_SECTION_ORDER) {
      for (const entity of lore.entitiesByType[sectionType]) {
        if (excludedNames.has((entity.entityName || '').toLowerCase())) continue;
        if (
          sectionType === 'npcs' &&
          playerCharacterFolded &&
          normalizePcName(entity.entityName || '') === playerCharacterFolded
        )
          continue;
        units.push({ entity, sectionType, order: units.length });
      }
    }

    let kept = units;
    let canonCut = false;
    if (options.turnScope) {
      const scope = options.turnScope;
      const activeNames = new Set(
        (options.activeEntityNames || []).map((name) => name.toLowerCase()),
      );
      const nameOf = (unit: (typeof units)[number]): string =>
        (unit.entity.entityName || '').toLowerCase();
      const cost = (unit: (typeof units)[number]): number =>
        approximateTokens(renderEntityBlock(unit.sectionType, unit.entity));
      // Two limits, neither charged for the scene: the per-turn allowance for cards chosen by
      // name, and (when given) what is left of the whole-canon token budget.
      let allowance = scope.entityTokenBudget;
      let remaining =
        options.tokenBudget === undefined
          ? Infinity
          : Math.max(
              0,
              options.tokenBudget -
                approximateTokens(head + tail + lore.assetsSection) -
                WRAPPER_TOKEN_ALLOWANCE,
            );
      // Scene-active entities are always kept, exactly as in the ranked path; they count
      // against the whole-canon budget but not against the per-turn allowance.
      kept = units.filter((unit) => activeNames.has(nameOf(unit)));
      for (const unit of kept) remaining = Math.max(0, remaining - cost(unit));
      const named = units
        .filter((unit) => !activeNames.has(nameOf(unit)))
        .map((unit) => ({
          unit,
          score: turnMentionScore(unit.entity.entityName || '', unit.sectionType, scope),
        }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.unit.order - b.unit.order);
      for (const { unit } of named) {
        if (cost(unit) <= Math.min(allowance, remaining)) {
          kept.push(unit);
          allowance -= cost(unit);
          remaining -= cost(unit);
        } else {
          canonCut = true;
        }
      }
      // A handout rides with the NPC who gives it.
      const keptNames = new Set(kept.map(nameOf));
      for (const unit of units) {
        if (unit.sectionType !== 'handouts' || kept.includes(unit)) continue;
        const giver = String((unit.entity.metadata as any)?.giver || '').toLowerCase();
        if (giver && keptNames.has(giver) && cost(unit) <= Math.min(allowance, remaining)) {
          kept.push(unit);
          allowance -= cost(unit);
          remaining -= cost(unit);
        }
      }
      kept.sort((a, b) => a.order - b.order);
    } else if (options.tokenBudget !== undefined) {
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
      // #352 (self-review): when entitiesOnly, the head/tail/assets are not
      // emitted (see below), so don't charge them against the budget — only
      // the <canonical_entities> wrapper allowance.
      const headTokens = options.entitiesOnly
        ? 0
        : approximateTokens(head + tail + lore.assetsSection);
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
      // #352 sceneOnly: the scene-stable section carries the scene's entities
      // (and their handouts) plus the name roster — never the relevance-ranked
      // fill. Per-turn input-matched extras ride the tail block instead.
      if (options.sceneOnly) {
        const keptNameSet = new Set(
          kept.map((unit) => (unit.entity.entityName || '').toLowerCase()),
        );
        for (const unit of scored) {
          if (unit.sectionType !== 'handouts' || kept.includes(unit)) continue;
          const giver = String(
            (unit.entity.metadata as any)?.giver || '',
          ).toLowerCase();
          const cost = approximateTokens(renderEntityBlock(unit.sectionType, unit.entity));
          if (giver && keptNameSet.has(giver) && cost <= remaining) {
            kept.push(unit);
            remaining -= cost;
          }
        }
      } else {
        for (const unit of scored.filter((unit) => !isActive(unit))) {
          const cost = approximateTokens(renderEntityBlock(unit.sectionType, unit.entity));
          if (cost <= remaining) {
            kept.push(unit);
            remaining -= cost;
          }
        }
      }
      // Restore canonical section order for rendering; relevance order only
      // decided which entities survived.
      kept.sort((a, b) => a.order - b.order);
      // #352: in sceneOnly mode the non-scene entities are rostered by design,
      // not cut by the budget — only a dropped scene entity counts as a cut.
      canonCut = options.sceneOnly
        ? units.some((unit) => {
            const name = (unit.entity.entityName || '').toLowerCase();
            return (
              activeNames.has(name) &&
              !kept.some((k) => (k.entity.entityName || '').toLowerCase() === name)
            );
          })
        : kept.length < units.length;
    }

    const notKept = units.filter((unit) => !kept.includes(unit));
    // #352: the roster also serves the scene-stable section (includeRoster),
    // whose instruction text already describes this exact arrangement. The
    // per-turn tail (entitiesOnly) skips it — the scene section carries the
    // full roster, so the tail only adds the extra cards.
    const roster =
      (options.turnScope || options.includeRoster) && !options.entitiesOnly
        ? renderCanonRoster(notKept)
        : '';
    const handoutIndex = notKept
      .filter((unit) => unit.sectionType === 'handouts')
      .map((unit) => unit.entity);

    let entitiesSection = '';
    if (kept.length > 0 || roster || handoutIndex.length > 0) {
      entitiesSection = `

<canonical_entities>
<instruction>These are the OFFICIAL NPCs, locations, and creatures for this campaign. USE THESE EXACT NAMES. Do NOT invent new NPCs when these exist.</instruction>`;
      for (const sectionType of LORE_SECTION_ORDER) {
        entitiesSection += renderEntityTypeSection(
          sectionType,
          kept.filter((unit) => unit.sectionType === sectionType).map((unit) => unit.entity),
          sectionType === 'handouts' ? handoutIndex : [],
        );
      }
      entitiesSection += roster;
      entitiesSection += `
</canonical_entities>`;
    }

    const keptNames = new Set(kept.map((unit) => (unit.entity.entityName || '').toLowerCase()));
    const droppedNames = new Set(
      units
        .filter((unit) => !keptNames.has((unit.entity.entityName || '').toLowerCase()))
        .map((unit) => (unit.entity.entityName || '').toLowerCase()),
    );
    const assetsSection =
      canonCut || options.turnScope
        ? filterAssetsSection(lore.assetsSection, droppedNames)
        : lore.assetsSection;

    // #352: the per-turn tail block wants only the entity cards, not the
    // setting head, adherence tail or assets (those live in the scene section).
    const section = options.entitiesOnly
      ? entitiesSection
      : head + entitiesSection + tail + assetsSection;
    const sectionTokens = approximateTokens(section);
    return {
      section,
      sectionTokens,
      canonCut,
      keptEntities: kept.length,
      droppedEntities: units.length - kept.length,
      keptEntityNames: kept.map((unit) => (unit.entity.entityName || '').toLowerCase()),
    };
  }

  public static async buildStarterCampaignLoreSection(
    starterCampaignId: string,
    options: LoreRenderOptions = {},
    playerCharacterName?: string,
  ): Promise<string> {
    const lore = await CampaignContextPrompts.fetchStarterCampaignLore(
      starterCampaignId,
      playerCharacterName,
    );
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
