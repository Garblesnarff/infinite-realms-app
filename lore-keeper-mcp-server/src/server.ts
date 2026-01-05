/**
 * Lore Keeper MCP Server
 *
 * A stateless MCP server that provides campaign lore to Franz (AI DM).
 * Queries Supabase for canonical campaign content via RAG.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { tools, handleToolCall } from './tools.js';

/**
 * An MCP server responsible for providing campaign lore to AI agents like Franz.
 * It exposes a set of tools for querying campaign data from Supabase.
 *
 * @example
 * ```typescript
 * const server = new LoreKeeperMcpServer();
 * await server.start();
 * ```
 */
export class LoreKeeperMcpServer {
  private server: Server;

  /**
   * Initializes a new instance of the LoreKeeperMcpServer, setting up the MCP server
   * and its request handlers.
   */
  constructor() {
    this.server = new Server(
      {
        name: 'lore-keeper-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await handleToolCall(name, args || {});

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: true,
                  message: errorMessage,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Starts the MCP server and begins listening for requests over the configured transport.
   * For this server, it uses STDIO to communicate with the parent process.
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log to stderr to avoid interfering with JSON-RPC
    console.error('Lore Keeper MCP Server started and ready for requests');
  }
}
