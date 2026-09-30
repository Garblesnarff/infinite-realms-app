/* eslint-disable max-lines */
/**
 * Content chunking logic for campaign files
 *
 * The goal is to create atomic, queryable pieces of lore.
 * Each chunk should be self-contained and answer a specific question.
 */

import { isSectionMarkerName, normalizeEntityNameForChunkType } from './entity-name.js';

import type { CampaignChunk, CampaignRule, CampaignFiles } from './types.js';

const MAX_CHUNK_SIZE = 2000; // Max characters per chunk

/**
 * Main function to chunk all campaign files
 */
export function chunkCampaignFiles(
  campaignId: string,
  files: CampaignFiles,
): { chunks: CampaignChunk[]; rules: CampaignRule[] } {
  const chunks: CampaignChunk[] = [];
  const rules: CampaignRule[] = [];

  // Normalize campaign ID to just the last part of the path
  const normalizedId = campaignId.split('/').pop() || campaignId;

  // Creative Brief - usually one chunk
  if (files.creativeBrief) {
    chunks.push(...chunkCreativeBrief(normalizedId, files.creativeBrief));
  }

  // World Building Spec
  if (files.worldBuildingSpec) {
    const worldChunks = chunkWorldBuilding(normalizedId, files.worldBuildingSpec);
    chunks.push(...worldChunks.chunks);
    rules.push(...worldChunks.rules);
  }

  // Campaign Bible - the richest content
  if (files.campaignBible) {
    chunks.push(...chunkCampaignBible(normalizedId, files.campaignBible));
  }

  return { chunks, rules };
}

/**
 * Chunk the creative brief
 */
function chunkCreativeBrief(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  // Creative brief is usually small enough to be one chunk
  // But let's split by major sections if it's large
  const sections = splitByHeaders(content, 2);

  if (sections.length <= 1 || content.length < MAX_CHUNK_SIZE) {
    chunks.push({
      campaignId,
      chunkType: 'creative_brief',
      content: cleanContent(content),
      summary: 'Art style, visual design, voice, and music direction for the campaign',
      metadata: {},
      sourceFile: 'creative_brief.md',
    });
  } else {
    // Split into sections
    sections.forEach((section, index) => {
      const headerMatch = section.match(/^##?\s*(.+)$/m);
      const sectionName = headerMatch ? headerMatch[1] : `Section ${index + 1}`;

      chunks.push({
        campaignId,
        chunkType: 'creative_brief',
        entityName: sectionName,
        content: cleanContent(section),
        metadata: { section: sectionName },
        sourceFile: 'creative_brief.md',
        sourceSection: sectionName,
      });
    });
  }

  return chunks;
}

/**
 * Chunk the world building spec and extract causality rules
 */
function chunkWorldBuilding(
  campaignId: string,
  content: string,
): { chunks: CampaignChunk[]; rules: CampaignRule[] } {
  const chunks: CampaignChunk[] = [];
  const rules: CampaignRule[] = [];

  // Extract causality rules (IF/THEN patterns)
  const causalitySection = extractSection(content, 'Causality');
  if (causalitySection) {
    rules.push(...extractCausalityRules(campaignId, causalitySection));
  }

  // World building as a whole chunk
  chunks.push({
    campaignId,
    chunkType: 'world_building',
    content: cleanContent(content),
    summary: 'Core concept, lore, history, and world structure',
    metadata: {},
    sourceFile: 'world_building_spec.md',
  });

  // Also extract specific sections
  const sections = [
    { name: 'Core Concept', key: 'core_concept' },
    { name: 'Lore', key: 'lore' },
    { name: 'History', key: 'history' },
  ];

  sections.forEach(({ name, key }) => {
    const section = extractSection(content, name);
    if (section && section.length > 100 && !isSectionMarkerName(name)) {
      chunks.push({
        campaignId,
        chunkType: 'world_building',
        entityName: name,
        content: cleanContent(section),
        metadata: { aspect: key },
        sourceFile: 'world_building_spec.md',
        sourceSection: name,
      });
    }
  });

  return { chunks, rules };
}

/**
 * Chunk the campaign bible - the most complex parsing
 */
function chunkCampaignBible(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  // Extract NPCs by tier
  chunks.push(...extractNPCs(campaignId, content));

  // Extract Factions
  chunks.push(...extractFactions(campaignId, content));

  // Extract Locations
  chunks.push(...extractLocations(campaignId, content));

  // Extract Quests
  chunks.push(...extractQuests(campaignId, content));

  // Extract Mechanics
  chunks.push(...extractMechanics(campaignId, content));

  // Extract Items
  chunks.push(...extractItems(campaignId, content));

  // Extract deliverable in-fiction documents.
  chunks.push(...extractHandouts(campaignId, content));

  // Extract Encounters/Bestiary
  chunks.push(...extractEncounters(campaignId, content));

  // Extract Session Outlines
  chunks.push(...extractSessionOutlines(campaignId, content));

  return chunks;
}

/**
 * Extract NPCs from campaign bible
 */
function extractNPCs(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  // Look for NPC sections
  const npcSection = extractSection(content, 'NPC') || extractSection(content, 'Major NPCs');

  if (!npcSection) return chunks;

  // Try multiple patterns for NPC extraction to handle different formats
  // Format 1: 1. **Name** (standard)
  // Format 2: **1. Name** (Abyssal Descent style - bold wraps the number)
  const patterns = [
    /(?=^\d+\.\s*\*\*)/m, // Split on: 1. **Name
    /(?=^\*\*\d+\.\s*)/m, // Split on: **1. Name
  ];

  let npcBlocks: string[] = [];
  for (const pattern of patterns) {
    npcBlocks = npcSection.split(pattern).filter((b) => b.trim());
    if (npcBlocks.length > 1) break;
  }

  npcBlocks.forEach((block, index) => {
    // Try multiple name extraction patterns
    let nameMatch = block.match(/^\d+\.\s*\*\*(.+?)\*\*/);
    if (!nameMatch) {
      // Abyssal format: **1. Name** (type) - description
      nameMatch = block.match(/^\*\*\d+\.\s*(.+?)\*\*/);
    }
    if (!nameMatch) return;

    const tier = determineTier(block, index);
    const name = normalizeEntityNameForChunkType(nameMatch[1], tier);
    if (!name || isSectionMarkerName(name)) return;

    chunks.push({
      campaignId,
      chunkType: tier,
      entityName: name,
      content: cleanContent(block),
      summary: extractNPCSummary(block, name),
      metadata: { tier: tier.replace('npc_', '') },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'NPCs',
    });
  });

  // Also try table format for Tier 2/3 NPCs
  for (const row of readNpcTableRows(npcSection)) {
    const normalizedName = normalizeEntityNameForChunkType(row.name, 'npc_tier2');
    if (
      normalizedName &&
      !isSectionMarkerName(normalizedName) &&
      !chunks.some((c) => c.entityName === normalizedName)
    ) {
      const raceLine = row.race === undefined ? '' : `\n\nRace: ${row.race || 'Unknown'}`;
      chunks.push({
        campaignId,
        chunkType: 'npc_tier2',
        entityName: normalizedName,
        content: `**${normalizedName}** - ${row.role || 'Unknown role'}${raceLine}\n\nLocation: ${row.location || 'Unknown'}\n\nQuirk: ${row.quirk || 'None noted'}`,
        summary: `${normalizedName}: ${row.role || 'NPC'}`,
        metadata: { tier: 'tier2', fromTable: true },
        sourceFile: 'campaign_bible.md',
        sourceSection: 'NPCs',
      });
    }
  }

  return chunks;
}

interface NpcTableRow {
  name: string;
  role: string;
  race?: string;
  location: string;
  quirk: string;
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Read `| **Name** | ... |` rows, mapping cells by the table's header row. A row under a
 * 4-column header (Name | Role | Location | Quirk) and a row under a 5-column header
 * (Name | Role | Race | Location | Quirk) both land in the right fields. The last cell is the
 * quirk; it carries any authored stat tail.
 */
function readNpcTableRows(npcSection: string): NpcTableRow[] {
  const rows: NpcTableRow[] = [];
  const lines = npcSection.split('\n');
  const isSeparator = (line: string | undefined): boolean =>
    /^\|[\s:|-]+\|$/.test((line ?? '').trim());
  let header: string[] | undefined;

  lines.forEach((line, i) => {
    if (!line.trim().startsWith('|')) {
      header = undefined;
      return;
    }
    if (isSeparator(line)) return;

    const cells = splitTableCells(line);
    if (isSeparator(lines[i + 1])) {
      header = cells.map((cell) => cell.replace(/\*/g, '').trim().toLowerCase());
      return;
    }
    const nameMatch = cells[0]?.match(/^\*\*(.+?)\*\*$/);
    if (!nameMatch) return;

    const column = (label: string): number => header?.findIndex((h) => h.startsWith(label)) ?? -1;
    const cellFor = (label: string, legacyIndex: number): string => {
      const index = column(label);
      return cells[index >= 0 ? index : legacyIndex] ?? '';
    };
    const raceIndex = column('race');
    const quirkIndex = column('quirk');
    rows.push({
      name: nameMatch[1],
      role: cellFor('role', 1),
      race: raceIndex >= 0 ? (cells[raceIndex] ?? '') : undefined,
      location: cellFor('location', 2),
      quirk: cells[quirkIndex >= 0 ? quirkIndex : header ? cells.length - 1 : 3] ?? '',
    });
  });

  return rows;
}

/**
 * Determine NPC tier based on content
 */
function determineTier(block: string, _index: number): 'npc_tier1' | 'npc_tier2' | 'npc_tier3' {
  // Tier 1 indicators: extensive description, personality, voice, goals, secrets
  const tier1Indicators = ['personality', 'voice', 'goal', 'secret', 'motivation'];
  const indicatorCount = tier1Indicators.filter((i) => block.toLowerCase().includes(i)).length;

  if (indicatorCount >= 2 || block.length > 500) return 'npc_tier1';
  if (indicatorCount >= 1 || block.length > 200) return 'npc_tier2';
  return 'npc_tier3';
}

/**
 * Extract a summary for an NPC
 */
function extractNPCSummary(block: string, name: string): string {
  // Try to find a one-liner description
  const dashMatch = block.match(/\*\*.*?\*\*\s*[—–-]\s*\*(.+?)\*/);
  if (dashMatch) return `${name}: ${dashMatch[1].trim()}`;

  // Try to find role/title in parentheses
  const parenMatch = block.match(/\(([^)]+)\)/);
  if (parenMatch) return `${name} (${parenMatch[1].trim()})`;

  // Fallback to first sentence
  const firstSentence = block.split(/[.!?]/)[0]?.replace(/\*\*/g, '').trim();
  if (firstSentence && firstSentence.length < 150) return firstSentence;

  return `${name}: Campaign NPC`;
}

/**
 * Extract Factions from campaign bible
 */
function extractFactions(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const factionSection = extractSection(content, 'Faction');
  if (!factionSection) return chunks;

  // Look for bracketed faction names like [The Court of Stolen Breath]
  const bracketPattern = /\[(.+?)\]\s*([\s\S]*?)(?=\n\[|\n###|\n##|$)/g;

  // Also try ### headers
  const headerPattern = /###\s*\[?(.+?)\]?\s*\n([\s\S]*?)(?=\n###|\n##|$)/g;

  const patterns = [bracketPattern, headerPattern];

  for (const pattern of patterns) {
    const matches = factionSection.matchAll(pattern);
    for (const match of matches) {
      const [, name, details] = match;
      const normalizedName = name ? normalizeEntityNameForChunkType(name, 'faction') : '';
      if (
        normalizedName &&
        !isSectionMarkerName(normalizedName) &&
        !chunks.some((c) => c.entityName === normalizedName)
      ) {
        chunks.push({
          campaignId,
          chunkType: 'faction',
          entityName: normalizedName,
          content: cleanContent(`**${normalizedName}**\n\n${details}`),
          summary: extractFactionSummary(details, normalizedName),
          metadata: extractFactionMetadata(details),
          sourceFile: 'campaign_bible.md',
          sourceSection: 'Factions',
        });
      }
    }
  }

  return chunks;
}

/**
 * Extract faction summary
 */
function extractFactionSummary(content: string, name: string): string {
  const typeMatch = content.match(/\*\*Type:\*\*\s*(.+)/i);
  const agendaMatch = content.match(/\*\*Agenda:\*\*\s*(.+)/i);

  if (typeMatch && agendaMatch) {
    return `${name}: ${typeMatch[1].trim()} - ${agendaMatch[1].trim().substring(0, 80)}`;
  }

  return `${name}: Campaign faction`;
}

/**
 * Extract faction metadata
 */
function extractFactionMetadata(content: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  const leaderMatch = content.match(/\*\*Leader:\*\*\s*(.+)/i);
  if (leaderMatch) metadata.leader = leaderMatch[1].trim();

  const typeMatch = content.match(/\*\*Type:\*\*\s*(.+)/i);
  if (typeMatch) metadata.type = typeMatch[1].trim();

  return metadata;
}

/**
 * Extract Locations from campaign bible
 */
function extractLocations(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const locationSection =
    extractSection(content, 'Location') || extractSection(content, 'World Map');
  if (!locationSection) return chunks;

  // Look for Zone headers (Abyssal Descent style)
  const zonePattern = /###\s*Zone\s*\d+:?\s*(.+?)\n([\s\S]*?)(?=###\s*Zone|##|$)/gi;
  const zoneMatches = locationSection.matchAll(zonePattern);

  for (const match of zoneMatches) {
    const [, zoneName, zoneContent] = match;

    // Zone overview
    chunks.push({
      campaignId,
      chunkType: 'location',
      entityName: zoneName.trim(),
      content: cleanContent(zoneContent),
      summary: `Zone: ${zoneName.trim()}`,
      metadata: { isZone: true },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Locations',
    });

    // Individual locations within zone
    const locationPattern = /\d+\.\s*\*\*(.+?)\*\*:?\s*([\s\S]*?)(?=\n\d+\.|\n###|$)/g;
    const locMatches = zoneContent.matchAll(locationPattern);

    for (const locMatch of locMatches) {
      const [, locName, locDetails] = locMatch;
      const normalizedName = normalizeEntityNameForChunkType(locName, 'location');
      if (!normalizedName || isSectionMarkerName(normalizedName)) continue;
      chunks.push({
        campaignId,
        chunkType: 'location',
        entityName: normalizedName,
        parentEntity: zoneName.trim(),
        content: cleanContent(`**${normalizedName}**\n\n${locDetails}`),
        summary: `Location in ${zoneName.trim()}: ${normalizedName}`,
        metadata: { zone: zoneName.trim() },
        sourceFile: 'campaign_bible.md',
        sourceSection: `Locations > ${zoneName.trim()}`,
      });
    }
  }

  // Bullet point locations (Eternal Feast style): *   **Location Name:** Description
  const bulletLocationPattern =
    /^\s*\*\s+\*\*(.+?)\*\*:?\s*(.+?)(?=^\s*\*\s+\*\*|^#{2,6}\s|^\s*\[TAG|^\s*---\s*$|$)/gms;
  const bulletMatches = locationSection.matchAll(bulletLocationPattern);

  for (const match of bulletMatches) {
    const [, locName, locDetails] = match;
    const normalizedName = normalizeEntityNameForChunkType(locName, 'location');
    if (
      normalizedName &&
      !isSectionMarkerName(normalizedName) &&
      !chunks.some((c) => c.entityName === normalizedName)
    ) {
      // Extract sensory details
      const smell = locDetails.match(/\*\*Smell:\*\*\s*(.+?)(?:\.|$)/i)?.[1];
      const sound = locDetails.match(/\*\*Sound:\*\*\s*(.+?)(?:\.|$)/i)?.[1];

      chunks.push({
        campaignId,
        chunkType: 'location',
        entityName: normalizedName,
        content: cleanContent(`**${normalizedName}**\n\n${locDetails}`),
        summary: `Location: ${normalizedName}`,
        metadata: {
          ...(smell && { smell: smell.trim() }),
          ...(sound && { sound: sound.trim() }),
        },
        sourceFile: 'campaign_bible.md',
        sourceSection: 'Locations',
      });
    }
  }

  return chunks;
}

/**
 * Extract Quests from campaign bible
 */
function extractQuests(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  // Main quest
  const mainQuestSection =
    extractSection(content, 'Main Quest') || extractSection(content, 'Quest Architecture');
  if (mainQuestSection) {
    // Extract numbered quest beats
    const beatPattern = /\d+\.\s*\*\*(.+?)\*\*:?\s*([\s\S]*?)(?=\n\d+\.|\n###|\n##|$)/g;
    const matches = mainQuestSection.matchAll(beatPattern);

    let sequenceOrder = 0;
    for (const match of matches) {
      const [, beatName, details] = match;
      sequenceOrder++;

      chunks.push({
        campaignId,
        chunkType: 'quest_main',
        entityName: beatName.trim(),
        content: cleanContent(`**${beatName.trim()}**\n\n${details}`),
        metadata: { beatNumber: sequenceOrder },
        sourceFile: 'campaign_bible.md',
        sourceSection: 'Main Quest',
        sequenceOrder,
      });
    }
  }

  // Side quests
  const sideQuestSection = extractSection(content, 'Side Quest');
  if (sideQuestSection) {
    // Table format
    const tablePattern = /\|\s*\*\*(.+?)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|/g;
    const matches = sideQuestSection.matchAll(tablePattern);

    for (const match of matches) {
      const [, name, giver, objective, reward] = match;
      if (name && name !== 'Quest Name') {
        chunks.push({
          campaignId,
          chunkType: 'quest_side',
          entityName: name.trim(),
          content: `**${name.trim()}**\n\nQuest Giver: ${giver?.trim() || 'Unknown'}\n\nObjective: ${objective?.trim() || 'Unknown'}\n\nReward: ${reward?.trim() || 'Unknown'}`,
          metadata: { questGiver: giver?.trim(), reward: reward?.trim() },
          sourceFile: 'campaign_bible.md',
          sourceSection: 'Side Quests',
        });
      }
    }
  }

  return chunks;
}

/**
 * Extract Mechanics from campaign bible
 */
function extractMechanics(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const mechanicsSection =
    extractSection(content, 'Mechanic') || extractSection(content, 'Unique Mechanic');
  if (!mechanicsSection) return chunks;

  // Look for numbered or ### mechanics
  const mechanicPattern = /(?:###|\d+\.)\s*\*\*?(.+?)\*\*?\s*\n([\s\S]*?)(?=###|\d+\.\s*\*|##|$)/g;
  const matches = mechanicsSection.matchAll(mechanicPattern);

  for (const match of matches) {
    const [, name, details] = match;
    chunks.push({
      campaignId,
      chunkType: 'mechanic',
      entityName: name.trim(),
      content: cleanContent(`**${name.trim()}**\n\n${details}`),
      summary: `Game mechanic: ${name.trim()}`,
      metadata: {},
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Mechanics',
    });
  }

  return chunks;
}

/**
 * Extract Items from campaign bible
 */
function extractItems(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const itemSection =
    extractSection(content, 'Item') ||
    extractSection(content, 'Artifact') ||
    extractSection(content, 'Loot');
  if (!itemSection) return chunks;

  // Numbered items
  const itemPattern = /\d+\.\s*\*\*(.+?)\*\*:?\s*([\s\S]*?)(?=\n\d+\.|\n###|\n##|$)/g;
  const matches = itemSection.matchAll(itemPattern);

  for (const match of matches) {
    const [, name, details] = match;
    const isArtifact =
      itemSection.toLowerCase().includes('artifact') || details.toLowerCase().includes('legendary');

    chunks.push({
      campaignId,
      chunkType: 'item',
      entityName: name.trim(),
      content: cleanContent(`**${name.trim()}**\n\n${details}`),
      metadata: { isArtifact },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Items',
    });
  }

  return chunks;
}

/**
 * Extract authored handouts from the campaign-bible format.
 *
 * Each entry is deliberately self-contained: runtime delivery validates `metadata.key`,
 * while the body remains embedded and available to RAG context.
 */
function extractHandouts(campaignId: string, content: string): CampaignChunk[] {
  const handoutSection = extractSection(content, 'Handouts');
  if (!handoutSection) return [];

  const chunks: CampaignChunk[] = [];
  const entryPattern = /^###\s+(.+?)\s*\n([\s\S]*?)(?=^###\s|^##\s|(?![\s\S]))/gm;
  for (const match of handoutSection.matchAll(entryPattern)) {
    const [, heading, details] = match;
    const key = details.match(/^\s*(?:[-*]\s*)?Key:\s*`?([^`\n]+)`?\s*$/im)?.[1]?.trim();
    const title =
      details.match(/^\s*(?:[-*]\s*)?Title:\s*(.+?)\s*$/im)?.[1]?.trim() || heading.trim();
    const giver = details.match(/^\s*(?:[-*]\s*)?Giver:\s*(.+?)\s*$/im)?.[1]?.trim();
    const bodyLabel = /^\s*(?:[-*]\s*)?Body:\s*$/im.exec(details);
    const body = bodyLabel
      ? details.slice(bodyLabel.index + bodyLabel[0].length).trim()
      : undefined;
    if (!key || !title || !giver || !body) continue;

    chunks.push({
      campaignId,
      chunkType: 'handout',
      entityName: title,
      content: cleanContent(`**${title}**\n\nGiver: ${giver}\n\n${body}`),
      summary: `Handout from ${giver}: ${title}`,
      metadata: { key, title, giver, body },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Handouts',
    });
  }
  return chunks;
}

/**
 * Extract Encounters/Bestiary from campaign bible
 */
function extractEncounters(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const encounterSection =
    extractSection(content, 'Bestiary') || extractSection(content, 'Encounter');
  if (!encounterSection) return chunks;

  // Numbered monster stat blocks
  // Format 1 (Abyssal): **1. The Chiropteran Hulk (CR 5)**
  // Format 2 (Eternal Feast): ### 1. Gluten Golem (CR 5)
  const monsterPatterns = [
    /\*\*(\d+)\.\s*(.+?)\s*\(CR\s*[\d/]+\)\*\*\s*([\s\S]*?)(?=\*\*\d+\.|##|$)/gi,
    /###\s*(\d+)\.\s*(.+?)\s*\(CR\s*[\d/]+\)\s*\n([\s\S]*?)(?=###\s*\d+\.|##|$|\[TAG)/gi,
  ];

  for (const monsterPattern of monsterPatterns) {
    const monsterMatches = encounterSection.matchAll(monsterPattern);

    for (const match of monsterMatches) {
      const [, _number, name, details] = match;
      if (!chunks.some((c) => c.entityName === name.trim())) {
        chunks.push({
          campaignId,
          chunkType: 'monster',
          entityName: name.trim(),
          content: cleanContent(`**${name.trim()}**\n\n${details}`),
          summary: `Monster: ${name.trim()}`,
          metadata: {
            isStatBlock: true,
            cr: extractCR(details),
          },
          sourceFile: 'campaign_bible.md',
          sourceSection: 'Bestiary',
        });
      }
    }
  }

  // Custom stat blocks (old format)
  const statBlockPattern = /###\s*Custom Stat Block:?\s*\*\*(.+?)\*\*\s*([\s\S]*?)(?=###|##|$)/gi;
  const matches = encounterSection.matchAll(statBlockPattern);

  for (const match of matches) {
    const [, name, details] = match;
    if (!chunks.some((c) => c.entityName === name.trim())) {
      chunks.push({
        campaignId,
        chunkType: 'monster',
        entityName: name.trim(),
        content: cleanContent(`**${name.trim()}**\n\n${details}`),
        summary: `Creature: ${name.trim()}`,
        metadata: { isStatBlock: true },
        sourceFile: 'campaign_bible.md',
        sourceSection: 'Bestiary',
      });
    }
  }

  // Encounter tables
  const tablePattern = /\*\*D20\s+(.+?)\*\*\s*([\s\S]*?)(?=\*\*D20|##|$)/gi;
  const tableMatches = encounterSection.matchAll(tablePattern);

  for (const match of tableMatches) {
    const [, tableName, tableContent] = match;
    chunks.push({
      campaignId,
      chunkType: 'encounter',
      entityName: `Encounter Table: ${tableName.trim()}`,
      content: cleanContent(tableContent),
      metadata: { isTable: true, environment: tableName.trim() },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Encounters',
    });
  }

  return chunks;
}

/**
 * Extract CR from monster details
 */
function extractCR(details: string): string | undefined {
  const match = details.match(/CR\s*([\d/]+)/i);
  return match ? match[1] : undefined;
}

/**
 * Extract Session Outlines from campaign bible
 */
function extractSessionOutlines(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const roadmapSection =
    extractSection(content, 'Campaign Roadmap') || extractSection(content, 'Session');
  if (!roadmapSection) return chunks;

  // Session patterns
  const sessionPattern = /\*\*Session\s*(\d+):?\s*(.+?)\*\*\s*([\s\S]*?)(?=\*\*Session|\n##|$)/gi;
  const matches = roadmapSection.matchAll(sessionPattern);

  for (const match of matches) {
    const [, number, title, details] = match;
    const sessionNum = parseInt(number, 10);
    const sessionTitle = normalizeEntityNameForChunkType(title, 'session_outline');
    const sessionName = sessionTitle
      ? `Session ${sessionNum}: ${sessionTitle}`
      : `Session ${sessionNum}:`;

    chunks.push({
      campaignId,
      chunkType: 'session_outline',
      entityName: sessionName,
      content: cleanContent(`**${sessionName}**\n\n${details}`),
      summary: sessionName,
      metadata: { sessionNumber: sessionNum },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Campaign Roadmap',
      sequenceOrder: sessionNum,
    });
  }

  return chunks;
}

/**
 * Extract causality rules from world building spec
 */
function extractCausalityRules(campaignId: string, content: string): CampaignRule[] {
  const rules: CampaignRule[] = [];

  // Pattern: IF ... THEN ...
  const ifThenPattern = /\*?\s*IF\s+(.+?)\s+THEN\s+(.+?)(?:\n|$)/gi;
  const matches = content.matchAll(ifThenPattern);

  // campaign_rules.priority is constrained to 1-10 and readers sort it descending. Rank by
  // document order: first rule 10, one less per rule, floor 1 (rules past the tenth tie).
  let rank = 0;
  for (const match of matches) {
    const [, condition, effect] = match;

    rules.push({
      campaignId,
      ruleType: 'causality',
      condition: condition.trim(),
      effect: effect.trim(),
      reversible: !effect.toLowerCase().includes('permanent'),
      priority: Math.max(1, 10 - rank++),
      metadata: {},
    });
  }

  return rules;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract a section from markdown by header name
 */
function extractSection(content: string, headerName: string): string | undefined {
  // Try multiple header formats to handle different bible styles
  const patterns = [
    // Standard: ## NPCs or ### NPCs
    new RegExp(`##\\s*\\d*\\.?\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'),
    new RegExp(`###\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i'),
    // Numbered sections: ## Section 3: NPC ROSTER
    new RegExp(
      `##\\s*Section\\s*\\d+:?\\s*[^\\n]*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i',
    ),
    // Bold labels: **Causality Chains**: or **NPCs**:
    new RegExp(`\\*\\*${headerName}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\n\\*\\*|\\n##|$)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return match[1];
  }

  return undefined;
}

/**
 * Split content by headers of a specific level
 */
function splitByHeaders(content: string, level: number): string[] {
  const pattern = new RegExp(`(?=^${'#'.repeat(level)}\\s)`, 'gm');
  return content.split(pattern).filter((s) => s.trim());
}

/**
 * Clean content - remove excessive whitespace, normalize formatting
 */
function cleanContent(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
