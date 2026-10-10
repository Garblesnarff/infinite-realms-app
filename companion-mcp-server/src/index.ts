#!/usr/bin/env bun
/**
 * Entry point for the companion MCP server (#215 step 1).
 *
 *   IR_DEMO_TOKEN=... bun src/index.ts
 *
 * Serves the six companion tools over Streamable HTTP at /mcp.
 * The demo token is read from the environment and never committed;
 * see .env.example.
 */

import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { CompanionApiClient } from './ir-client.js';
import { startMcpHttpServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: join(here, '../.env') });

async function main(): Promise<void> {
  const { irApiBaseUrl, demoToken, mcpPort } = loadConfig();
  const client = new CompanionApiClient(irApiBaseUrl, demoToken);
  const running = await startMcpHttpServer(client, mcpPort);
  console.error(
    `Companion MCP server listening at ${running.url} (upstream ${irApiBaseUrl})`,
  );
  console.error(
    `Simulated Alexa+ web client at ${running.url.replace(/\/mcp$/, '/')} (#215 step 3b)`,
  );

  const shutdown = (): void => {
    console.error('Companion MCP server shutting down...');
    void running.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(
    'Failed to start companion MCP server:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
