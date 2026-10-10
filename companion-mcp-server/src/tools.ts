/**
 * MCP tool definitions for the Infinite Realms AI party member (#215 step 1).
 *
 * Each tool wraps one route of the companion API
 * (ai-adventure-scribe-main/server-bun/src/routes/v1/companion-routes.ts).
 * Per the hackathon design notes, tools return data, not a script: the voice
 * client writes its own spoken reply from the returned JSON.
 */

import { z } from 'zod';

import { CompanionApiClient, IrApiError } from './ir-client.js';

const sessionIdSchema = z
  .string()
  .min(1)
  .max(255)
  .describe('The game session id the companion acts in.');

const companionIdSchema = z
  .string()
  .min(1)
  .max(255)
  .describe('The companion id returned by join_party.');

/**
 * The shape the MCP SDK's registerTool callback accepts. It carries an
 * index signature (the SDK types the client result as
 * `{ [x: string]: unknown; content: [...] }`), so a plain interface
 * without one is not assignable.
 */
export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function ok(data: unknown): ToolCallResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function toolError(error: unknown): ToolCallResult {
  // The demo token never appears here: IrApiError describes status + body
  // only, and nothing else in this file touches the token.
  const message = error instanceof Error ? error.message : 'Unknown tool error';
  const status = error instanceof IrApiError ? error.status : undefined;
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, status }) }],
    isError: true,
  };
}

export interface CompanionTool {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: { readOnlyHint?: boolean };
  handler: (args: Record<string, unknown>, client: CompanionApiClient) => Promise<ToolCallResult>;
}

async function guarded<T>(fn: () => Promise<T>): Promise<ToolCallResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return toolError(error);
  }
}

export const tools: CompanionTool[] = [
  {
    name: 'join_party',
    description:
      'Add one of the player\'s characters to the session as an AI companion (at most 2 active). Returns the companion record and the current party roster.',
    inputSchema: {
      session_id: sessionIdSchema,
      character_id: z
        .string()
        .min(1)
        .max(255)
        .describe('The character id to join as a companion (not the session main character).'),
    },
    handler: (args, client) =>
      guarded(() =>
        client.join(args.session_id as string, args.character_id as string),
      ),
  },
  {
    name: 'list_companions',
    description: 'List the AI companions currently active in a game session.',
    inputSchema: { session_id: sessionIdSchema },
    annotations: { readOnlyHint: true },
    handler: (args, client) => guarded(() => client.list(args.session_id as string)),
  },
  {
    name: 'leave_party',
    description: 'Remove an AI companion from the game session.',
    inputSchema: {
      session_id: sessionIdSchema,
      companion_id: companionIdSchema,
    },
    handler: (args, client) =>
      guarded(() =>
        client.leave(args.session_id as string, args.companion_id as string),
      ),
  },
  {
    name: 'get_scene',
    description:
      'Read the current scene for a session: campaign, scene description, party roster, recent dialogue, and redacted combat state. Pass companion_id for the companion\'s point of view.',
    inputSchema: {
      session_id: sessionIdSchema,
      companion_id: z
        .string()
        .min(1)
        .max(255)
        .optional()
        .describe('Optional companion id requesting the scene.'),
    },
    annotations: { readOnlyHint: true },
    handler: (args, client) =>
      guarded(() =>
        client.scene(args.session_id as string, args.companion_id as string | undefined),
      ),
  },
  {
    name: 'speak_as_companion',
    description:
      'Have the AI companion speak in character. The line is sanitized server-side and written to the session transcript.',
    inputSchema: {
      session_id: sessionIdSchema,
      companion_id: companionIdSchema,
      text: z
        .string()
        .min(1)
        .max(20_000)
        .describe('What the companion says, in character.'),
    },
    handler: (args, client) =>
      guarded(() =>
        client.say(
          args.session_id as string,
          args.companion_id as string,
          args.text as string,
        ),
      ),
  },
  {
    name: 'roll_for_companion',
    description:
      'Make a server-side d20 roll for the companion: a skill check, ability check, or saving throw. Returns the d20, modifier, total, and breakdown.',
    inputSchema: {
      session_id: sessionIdSchema,
      companion_id: companionIdSchema,
      kind: z
        .enum(['skill', 'ability', 'save'])
        .describe('The kind of d20 roll.'),
      name: z
        .string()
        .min(1)
        .max(64)
        .describe('Skill, ability, or save name, e.g. "Persuasion" or "Dexterity".'),
      reason: z
        .string()
        .max(500)
        .optional()
        .describe('Why the roll is being made.'),
    },
    handler: (args, client) =>
      guarded(() =>
        client.roll(args.session_id as string, args.companion_id as string, {
          kind: args.kind as 'skill' | 'ability' | 'save',
          name: args.name as string,
          reason: args.reason as string | undefined,
        }),
      ),
  },
];
