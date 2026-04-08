/**
 * XML Tag Parser for DM Responses
 * Extracts memories and world updates from AI-generated narrative
 * Extracted from ai-service.ts for modularity
 */

/**
 * Parsed XML tags from DM response
 */
export interface ParsedXMLTags {
  /** Clean narrative text with XML tags removed */
  narrative: string;
  /** Extracted memory entries */
  memories: string[];
  /** Extracted world state updates */
  worldUpdates: {
    npcs: Array<{ name: string; description: string; location: string }>;
    locations: Array<{ name: string; description: string; status: string }>;
    quests: Array<{ name: string; update: string }>;
  };
  /** Whether any XML tags were found */
  hadTags: boolean;
}

/**
 * Parse XML tags from DM response for memories and world updates
 * This allows single-call extraction instead of separate API calls
 *
 * Expected format:
 * ```
 * Your narrative response here...
 *
 * <memories>
 * - Key fact or event
 * - Important NPC relationship
 * </memories>
 *
 * <world_updates>
 * - npc: Name | Description | Location
 * - location: Name | Description | Status
 * - quest: Quest name | Status update
 * </world_updates>
 * ```
 */
export function parseXMLTagsFromResponse(rawResponse: string): ParsedXMLTags {
  // Extract narrative (everything before XML tags)
  const narrative = rawResponse
    .replace(/<memories>[\s\S]*?<\/memories>/gi, '')
    .replace(/<world_updates>[\s\S]*?<\/world_updates>/gi, '')
    .trim();

  // Extract memories
  const memoriesMatch = rawResponse.match(/<memories>([\s\S]*?)<\/memories>/i);
  const memories = memoriesMatch
    ? memoriesMatch[1]
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0)
    : [];

  // Extract world updates
  const worldMatch = rawResponse.match(/<world_updates>([\s\S]*?)<\/world_updates>/i);
  const worldUpdates: ParsedXMLTags['worldUpdates'] = {
    npcs: [],
    locations: [],
    quests: [],
  };

  if (worldMatch) {
    const lines = worldMatch[1].split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.replace(/^-\s*/, '').trim();

      // Parse NPC: "npc: Name | Description | Location"
      const npcMatch = trimmed.match(/^npc:\s*([^|]+)\|([^|]+)\|(.+)$/i);
      if (npcMatch) {
        worldUpdates.npcs.push({
          name: npcMatch[1].trim(),
          description: npcMatch[2].trim(),
          location: npcMatch[3].trim(),
        });
        continue;
      }

      // Parse Location: "location: Name | Description | Status"
      const locMatch = trimmed.match(/^location:\s*([^|]+)\|([^|]+)\|(.+)$/i);
      if (locMatch) {
        worldUpdates.locations.push({
          name: locMatch[1].trim(),
          description: locMatch[2].trim(),
          status: locMatch[3].trim(),
        });
        continue;
      }

      // Parse Quest: "quest: Name | Update"
      const questMatch = trimmed.match(/^quest:\s*([^|]+)\|(.+)$/i);
      if (questMatch) {
        worldUpdates.quests.push({
          name: questMatch[1].trim(),
          update: questMatch[2].trim(),
        });
      }
    }
  }

  return {
    narrative,
    memories,
    worldUpdates,
    hadTags: memoriesMatch !== null || worldMatch !== null,
  };
}
