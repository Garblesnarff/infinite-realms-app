/**
 * Content chunking logic for campaign files
 *
 * The goal is to create atomic, queryable pieces of lore.
 * Each chunk should be self-contained and answer a specific question.
 */

import type { CampaignChunk, CampaignRule, ChunkType, CampaignFiles } from './types.js';

const MAX_CHUNK_SIZE = 2000; // Max characters per chunk

/**
 * Main function to chunk all campaign files
 */
export function chunkCampaignFiles(
  campaignId: string,
  files: CampaignFiles
): { chunks: CampaignChunk[]; rules: CampaignRule[] } {
  const chunks: CampaignChunk[] = [];
  const rules: CampaignRule[] = [];

  // Creative Brief - usually one chunk
  if (files.creativeBrief) {
    chunks.push(...chunkCreativeBrief(campaignId, files.creativeBrief));
  }

  // World Building Spec
  if (files.worldBuildingSpec) {
    const worldChunks = chunkWorldBuilding(campaignId, files.worldBuildingSpec);
    chunks.push(...worldChunks.chunks);
    rules.push(...worldChunks.rules);
  }

  // Campaign Bible - the richest content
  if (files.campaignBible) {
    chunks.push(...chunkCampaignBible(campaignId, files.campaignBible));
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
  content: string
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
    if (section && section.length > 100) {
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

  // Tier 1 NPCs - major characters with detailed info
  const tier1Pattern = /\*\*\d+\.\s*(.+?)\*\*.*?(?=\*\*\d+\.|###|##|$)/gs;
  const boldNamePattern = /^\d+\.\s*\*\*(.+?)\*\*/gm;

  // Try different patterns for NPC extraction
  const npcBlocks = npcSection.split(/(?=^\d+\.\s*\*\*)/m).filter(b => b.trim());

  npcBlocks.forEach((block, index) => {
    const nameMatch = block.match(/^\d+\.\s*\*\*(.+?)\*\*/);
    if (!nameMatch) return;

    const name = nameMatch[1].trim();
    const tier = determineTier(block, index);

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
  const tableMatches = npcSection.matchAll(/\|\s*\*\*(.+?)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|/g);
  for (const match of tableMatches) {
    const [, name, role, location, quirk] = match;
    if (name && !chunks.some(c => c.entityName === name.trim())) {
      chunks.push({
        campaignId,
        chunkType: 'npc_tier2',
        entityName: name.trim(),
        content: `**${name.trim()}** - ${role?.trim() || 'Unknown role'}\n\nLocation: ${location?.trim() || 'Unknown'}\n\nQuirk: ${quirk?.trim() || 'None noted'}`,
        summary: `${name.trim()}: ${role?.trim() || 'NPC'}`,
        metadata: { tier: 'tier2', fromTable: true },
        sourceFile: 'campaign_bible.md',
        sourceSection: 'NPCs',
      });
    }
  }

  return chunks;
}

/**
 * Determine NPC tier based on content
 */
function determineTier(block: string, index: number): 'npc_tier1' | 'npc_tier2' | 'npc_tier3' {
  // Tier 1 indicators: extensive description, personality, voice, goals, secrets
  const tier1Indicators = ['personality', 'voice', 'goal', 'secret', 'motivation'];
  const indicatorCount = tier1Indicators.filter(i =>
    block.toLowerCase().includes(i)
  ).length;

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
      if (name && !chunks.some(c => c.entityName === name.trim())) {
        chunks.push({
          campaignId,
          chunkType: 'faction',
          entityName: name.trim(),
          content: cleanContent(`**${name.trim()}**\n\n${details}`),
          summary: extractFactionSummary(details, name.trim()),
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

  const locationSection = extractSection(content, 'Location') || extractSection(content, 'World Map');
  if (!locationSection) return chunks;

  // Look for Zone headers
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
      chunks.push({
        campaignId,
        chunkType: 'location',
        entityName: locName.trim(),
        parentEntity: zoneName.trim(),
        content: cleanContent(`**${locName.trim()}**\n\n${locDetails}`),
        summary: `Location in ${zoneName.trim()}: ${locName.trim()}`,
        metadata: { zone: zoneName.trim() },
        sourceFile: 'campaign_bible.md',
        sourceSection: `Locations > ${zoneName.trim()}`,
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
  const mainQuestSection = extractSection(content, 'Main Quest') || extractSection(content, 'Quest Architecture');
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

  const mechanicsSection = extractSection(content, 'Mechanic') || extractSection(content, 'Unique Mechanic');
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

  const itemSection = extractSection(content, 'Item') || extractSection(content, 'Artifact') || extractSection(content, 'Loot');
  if (!itemSection) return chunks;

  // Numbered items
  const itemPattern = /\d+\.\s*\*\*(.+?)\*\*:?\s*([\s\S]*?)(?=\n\d+\.|\n###|\n##|$)/g;
  const matches = itemSection.matchAll(itemPattern);

  for (const match of matches) {
    const [, name, details] = match;
    const isArtifact = itemSection.toLowerCase().includes('artifact') ||
                       details.toLowerCase().includes('legendary');

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
 * Extract Encounters/Bestiary from campaign bible
 */
function extractEncounters(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const encounterSection = extractSection(content, 'Bestiary') || extractSection(content, 'Encounter');
  if (!encounterSection) return chunks;

  // Custom stat blocks
  const statBlockPattern = /###\s*Custom Stat Block:?\s*\*\*(.+?)\*\*\s*([\s\S]*?)(?=###|##|$)/gi;
  const matches = encounterSection.matchAll(statBlockPattern);

  for (const match of matches) {
    const [, name, details] = match;
    chunks.push({
      campaignId,
      chunkType: 'encounter',
      entityName: name.trim(),
      content: cleanContent(`**${name.trim()}**\n\n${details}`),
      summary: `Creature: ${name.trim()}`,
      metadata: { isStatBlock: true },
      sourceFile: 'campaign_bible.md',
      sourceSection: 'Bestiary',
    });
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
 * Extract Session Outlines from campaign bible
 */
function extractSessionOutlines(campaignId: string, content: string): CampaignChunk[] {
  const chunks: CampaignChunk[] = [];

  const roadmapSection = extractSection(content, 'Campaign Roadmap') || extractSection(content, 'Session');
  if (!roadmapSection) return chunks;

  // Session patterns
  const sessionPattern = /\*\*Session\s*(\d+):?\s*(.+?)\*\*\s*([\s\S]*?)(?=\*\*Session|\n##|$)/gi;
  const matches = roadmapSection.matchAll(sessionPattern);

  for (const match of matches) {
    const [, number, title, details] = match;
    const sessionNum = parseInt(number, 10);

    chunks.push({
      campaignId,
      chunkType: 'session_outline',
      entityName: `Session ${sessionNum}: ${title.trim()}`,
      content: cleanContent(`**Session ${sessionNum}: ${title.trim()}**\n\n${details}`),
      summary: `Session ${sessionNum}: ${title.trim()}`,
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

  let priority = 5;
  for (const match of matches) {
    const [, condition, effect] = match;

    rules.push({
      campaignId,
      ruleType: 'causality',
      condition: condition.trim(),
      effect: effect.trim(),
      reversible: !effect.toLowerCase().includes('permanent'),
      priority: priority--,
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
  // Try both ## and ### headers
  const patterns = [
    new RegExp(`##\\s*\\d*\\.?\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i'),
    new RegExp(`###\\s*${headerName}[^\\n]*\\n([\\s\\S]*?)(?=\\n###|\\n##|$)`, 'i'),
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
  return content.split(pattern).filter(s => s.trim());
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
