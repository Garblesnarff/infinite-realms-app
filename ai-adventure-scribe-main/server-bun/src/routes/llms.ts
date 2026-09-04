import { Elysia } from 'elysia';

import { getSiteConfig } from '../config/site.js';

/**
 * Generate llms.txt content - documentation index for AI agents
 * Following the llms.txt specification: https://llmstxt.org
 */
function generateLlmsTxt(siteUrl: string): string {
  return `# Infinite Realms

> AI-powered D&D game master for solo tabletop RPG adventures

## About

Infinite Realms is an AI-powered Dungeons & Dragons game master that enables solo tabletop RPG adventures. It handles combat mechanics, storytelling, NPC interactions, and world-building using the D&D 5th Edition ruleset.

## Documentation

- [Blog](${siteUrl}/blog) - Game tips, updates, D&D guides
- [API Docs](${siteUrl}/swagger) - REST API documentation
- [RSS Feed](${siteUrl}/rss.xml) - Latest blog posts
- [Sitemap](${siteUrl}/sitemap.xml) - All pages index

## Key Pages

- [AI Game Master](${siteUrl}/ai-game-master) - Feature overview
- [Solo Tabletop RPG](${siteUrl}/solo-tabletop-rpg) - Getting started

## Features

- AI-powered Dungeon Master
- D&D 5E combat system with dice rolling
- Character creation and management
- Campaign and session tracking
- Spell slot and inventory management
- Real-time game state synchronization

## Technical

- Frontend: React SPA with TypeScript
- Backend: Bun/Elysia API server
- Database: PostgreSQL via Supabase
- AI: Gemini 2.5 Flash for game master responses
`;
}

/**
 * Generate llms-full.txt content - expanded documentation index
 * Includes more detailed API information
 */
function generateLlmsFullTxt(siteUrl: string): string {
  const baseTxt = generateLlmsTxt(siteUrl);

  return `${baseTxt}
## API Overview

Base URL: ${siteUrl}

### Authentication
- POST /v1/auth/login - User authentication via WorkOS
- POST /v1/auth/logout - End session

### Characters
- GET /v1/characters - List user's characters
- POST /v1/characters - Create new character
- GET /v1/characters/:id - Get character details
- PATCH /v1/characters/:id - Update character

### Campaigns
- GET /v1/campaigns - List campaigns
- POST /v1/campaigns - Create campaign
- GET /v1/campaigns/:id - Get campaign details

### Game Sessions
- GET /v1/sessions - List sessions
- POST /v1/sessions - Start new session
- GET /v1/sessions/:id - Get session details

### AI Chat
- POST /v1/llm/chat - Send message to AI game master (streaming response)

### Combat
- POST /v1/combat/sessions/:sessionId/enter - Enter encounter after the server-side combat gate
- POST /v1/combat/:encounterId/roll-initiative - Roll initiative
- POST /v1/combat/:encounterId/attack - Make attack roll
- POST /v1/combat/:encounterId/intent - Submit combat intent (damage/healing applied server-side)
- GET /v1/combat/:encounterId/status - Encounter status

### D&D Mechanics
- GET /v1/spells - List available spells
- GET /v1/spell-slots/calculate - Calculate spell slots for a class/level
- POST /v1/spell-slots/calculate-multiclass - Calculate multiclass spell slots
- POST /v1/rest/characters/:id/short - Take short rest
- POST /v1/rest/characters/:id/long - Take long rest

## Notes for AI Agents

- Most endpoints require authentication
- Use \`Accept: text/markdown\` header on blog pages to receive clean Markdown
- Rate limits apply to AI chat endpoints
- Streaming responses use Server-Sent Events
`;
}

/**
 * LLM documentation routes
 * Serves llms.txt and llms-full.txt for AI agent discovery
 */
export const llmsRoutes = new Elysia()
  // Main llms.txt - concise documentation index
  .get('/llms.txt', ({ set }) => {
    const site = getSiteConfig();
    const content = generateLlmsTxt(site.url);

    set.headers['Content-Type'] = 'text/plain; charset=utf-8';
    set.headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';
    set.headers['Link'] = '</llms.txt>; rel="llms-txt"';
    set.headers['X-Llms-Txt'] = '/llms.txt';

    return content;
  })
  // Expanded llms-full.txt - includes API details
  .get('/llms-full.txt', ({ set }) => {
    const site = getSiteConfig();
    const content = generateLlmsFullTxt(site.url);

    set.headers['Content-Type'] = 'text/plain; charset=utf-8';
    set.headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';
    set.headers['Link'] = '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"';
    set.headers['X-Llms-Txt'] = '/llms.txt';

    return content;
  });
