import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const routeRoot = process.cwd().endsWith('server-bun')
  ? join(process.cwd(), 'src/routes/v1')
  : join(process.cwd(), 'server-bun/src/routes/v1');
const sessions = readFileSync(join(routeRoot, 'sessions.ts'), 'utf8');
const securedData = readFileSync(join(routeRoot, 'secured-game-data.ts'), 'utf8');

describe('secured game route contracts', () => {
  it('protects every new route group with requireAuth', () => {
    expect(sessions).toContain('.use(requireAuth)');
    expect(securedData).toContain('.use(requireAuth)');
    expect(securedData.indexOf(".get('/starter-character-templates'")).toBeLessThan(
      securedData.indexOf('.use(requireAuth)'),
    );
    expect(securedData).toContain("key: 'starter-character-templates:get'");
  });

  it('declares session context, list, update, quest, and template routes', () => {
    for (const declaration of [
      /\.get\('\/:id\/context'/,
      /\.get\(\s*'\/'/,
      /\.patch\(\s*'\/:id'/,
      /\.get\('\/quests'/,
      /'\/quests\/upsert'/,
      /\.get\('\/starter-character-templates'/,
      /\.get\('\/characters\/:id\/quest-progress'/,
    ])
      expect(sessions + securedData).toMatch(declaration);
  });

  it('keeps ownership checks and API-compatible joined fields in the route path', () => {
    expect(sessions).toContain('getSessionContextRouteResult');
    expect(securedData).toContain('ownsCampaign(quests.campaignId, user.userId)');
    expect(securedData).toContain('CampaignService.getById(body.campaign_id, user.userId)');
    for (const field of ['campaign_id', 'quest_type', 'starter_character_templates']) {
      expect(sessions + securedData).toContain(field);
    }
  });
});
