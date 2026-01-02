/**
 * Lore Keeper MCP Tools Definition
 *
 * These tools are used by Franz (AI DM) to query campaign lore.
 */

import * as db from './database.js';
import type { ChunkType } from './types.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export const tools: ToolDefinition[] = [
  // Campaign Discovery
  {
    name: 'list_campaigns',
    description:
      'List available starter campaigns. Only returns published and complete campaigns. Use for browsing or recommending campaigns to players.',
    inputSchema: {
      type: 'object',
      properties: {
        genre: {
          type: 'string',
          description: 'Filter by genre (e.g., "fantasy", "horror", "comedy")',
        },
        difficulty: {
          type: 'string',
          enum: ['easy', 'low-medium', 'medium', 'medium-hard', 'hard', 'deadly'],
          description: 'Filter by difficulty level',
        },
        featured: {
          type: 'boolean',
          description: 'Only return featured campaigns',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_campaign_overview',
    description:
      'Get full campaign details including creative brief, overview, and metadata. Use when you need the "big picture" of a campaign or to describe its tone and style.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID (directory name, e.g., "a_midsummer_nights_chaos")',
        },
      },
      required: ['campaign_id'],
    },
  },

  // Lore Retrieval - Direct Lookup
  {
    name: 'get_npc',
    description:
      'Get detailed information about a specific NPC by name. Includes personality, voice, goals, and secrets. Use when you know the NPC name.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
        name: {
          type: 'string',
          description: 'The NPC name (case-insensitive)',
        },
      },
      required: ['campaign_id', 'name'],
    },
  },
  {
    name: 'get_location',
    description:
      'Get detailed information about a specific location by name. Includes sensory details, notable features, and connected locations.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
        name: {
          type: 'string',
          description: 'The location name (case-insensitive)',
        },
      },
      required: ['campaign_id', 'name'],
    },
  },
  {
    name: 'get_faction',
    description:
      'Get detailed information about a specific faction by name. Includes leader, agenda, assets, and rivals.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
        name: {
          type: 'string',
          description: 'The faction name (case-insensitive)',
        },
      },
      required: ['campaign_id', 'name'],
    },
  },
  {
    name: 'get_mechanics',
    description:
      'Get all unique game mechanics for a campaign. These are special rules and systems unique to this campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_rules',
    description:
      'Get causality rules for a campaign. These are IF/THEN rules that govern world consequences. Check at key decision points.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
      },
      required: ['campaign_id'],
    },
  },

  // Lore Retrieval - Semantic Search
  {
    name: 'search_lore',
    description:
      'Semantic search across all campaign lore. Use when you need to find relevant information but don\'t know the exact entity name. Returns results with similarity scores - below 0.7 may be weak matches.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
        query: {
          type: 'string',
          description: 'Natural language query describing what you\'re looking for',
        },
        chunk_types: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'creative_brief',
              'world_building',
              'faction',
              'npc_tier1',
              'npc_tier2',
              'npc_tier3',
              'location',
              'quest_main',
              'quest_side',
              'mechanic',
              'item',
              'encounter',
              'session_outline',
            ],
          },
          description: 'Filter by chunk types (optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 5)',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['campaign_id', 'query'],
    },
  },

  // Party Access
  {
    name: 'get_starter_parties',
    description:
      'List available pre-built party options for a campaign. Players can select these for immediate play.',
    inputSchema: {
      type: 'object',
      properties: {
        campaign_id: {
          type: 'string',
          description: 'The campaign ID',
        },
      },
      required: ['campaign_id'],
    },
  },
  {
    name: 'get_party_details',
    description:
      'Get full party details including all character sheets with stats, backstories, and campaign hooks.',
    inputSchema: {
      type: 'object',
      properties: {
        party_id: {
          type: 'string',
          description: 'The party UUID',
        },
      },
      required: ['party_id'],
    },
  },
];

// =============================================================================
// TOOL HANDLERS
// =============================================================================

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    // Campaign Discovery
    case 'list_campaigns':
      return db.listCampaigns({
        genre: args.genre as string | undefined,
        difficulty: args.difficulty as string | undefined,
        featured: args.featured as boolean | undefined,
      });

    case 'get_campaign_overview': {
      const campaign = await db.getCampaignOverview(args.campaign_id as string);
      if (!campaign) {
        return { error: true, message: `Campaign not found: ${args.campaign_id}` };
      }
      return campaign;
    }

    // Lore Retrieval - Direct Lookup
    case 'get_npc': {
      const npc = await db.getNPC(args.campaign_id as string, args.name as string);
      if (!npc) {
        return {
          error: true,
          message: `NPC "${args.name}" not found in campaign ${args.campaign_id}`,
          suggestion: 'Try using search_lore for a fuzzy search',
        };
      }
      return npc;
    }

    case 'get_location': {
      const location = await db.getLocation(args.campaign_id as string, args.name as string);
      if (!location) {
        return {
          error: true,
          message: `Location "${args.name}" not found in campaign ${args.campaign_id}`,
          suggestion: 'Try using search_lore for a fuzzy search',
        };
      }
      return location;
    }

    case 'get_faction': {
      const faction = await db.getFaction(args.campaign_id as string, args.name as string);
      if (!faction) {
        return {
          error: true,
          message: `Faction "${args.name}" not found in campaign ${args.campaign_id}`,
          suggestion: 'Try using search_lore for a fuzzy search',
        };
      }
      return faction;
    }

    case 'get_mechanics':
      return db.getMechanics(args.campaign_id as string);

    case 'get_rules':
      return db.getRules(args.campaign_id as string);

    // Lore Retrieval - Semantic Search
    case 'search_lore':
      return db.searchLore(args.campaign_id as string, args.query as string, {
        chunkTypes: args.chunk_types as ChunkType[] | undefined,
        limit: args.limit as number | undefined,
      });

    // Party Access
    case 'get_starter_parties':
      return db.getStarterParties(args.campaign_id as string);

    case 'get_party_details': {
      const details = await db.getPartyDetails(args.party_id as string);
      if (!details) {
        return { error: true, message: `Party not found: ${args.party_id}` };
      }
      return details;
    }

    default:
      return { error: true, message: `Unknown tool: ${name}` };
  }
}
