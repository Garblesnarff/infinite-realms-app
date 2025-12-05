#!/usr/bin/env node
/**
 * Lore Keeper MCP Server Entry Point
 *
 * A stateless MCP server that provides campaign lore to Franz (AI DM).
 * Runs on Hetzner alongside the main Infinite Realms app.
 *
 * Environment Variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for full access
 *   OPENAI_API_KEY - For embedding generation in semantic search
 */

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { initialize } from './database.js';
import { LoreKeeperMcpServer } from './server.js';

// Load environment variables
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });
config({ path: join(__dirname, '../../.env') });
config({ path: join(__dirname, '../../../ai-adventure-scribe-main/.env') });

async function main(): Promise<void> {
  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing required environment variables:');
    if (!supabaseUrl) console.error('  - SUPABASE_URL or VITE_SUPABASE_URL');
    if (!supabaseKey) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!openaiKey) {
    console.error('⚠️  OPENAI_API_KEY not set - semantic search will be disabled');
  }

  // Initialize database connection
  initialize(supabaseUrl, supabaseKey, openaiKey);

  // Start MCP server
  const server = new LoreKeeperMcpServer();
  await server.start();

  // Graceful shutdown handlers
  const shutdown = (): void => {
    console.error('Lore Keeper MCP Server shutting down...');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error('Failed to start Lore Keeper MCP Server:', error);
  process.exit(1);
});
