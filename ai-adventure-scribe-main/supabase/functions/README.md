# Supabase Edge Functions

## Purpose

This directory contains Supabase Edge Functions. Most legacy Edge Functions (`dm-agent-execute`, `rules-interpreter-execute`, `generate-embedding`) have been retired; AI turn generation, rule evaluation, and embeddings run directly on the Bun/Elysia backend server.

## Active Functions

- **`clone-template/`**: Clones campaign templates during character creation.

## Structure

- **`index.ts`**: Main entry point for the Edge Function.
- **`config.toml`**: Supabase Edge Functions configuration.
