import { describe, expect, it, mock } from 'bun:test';

const campaignChunks = { table: 'campaign_chunks' };
const npcs = { table: 'npcs' };

mock.module('../../../../../db/client.js', () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === npcs
            ? [{ name: 'Campaign NPC', id: 'npc-1' }]
            : [
                {
                  entityName: 'Asset NPC',
                  metadata: { slug: 'asset-npc', monster_id: 'srd:bandit' },
                },
              ],
      }),
    }),
  },
}));
mock.module('../../../../../db/schema/index.js', () => ({ campaignChunks, npcs }));
mock.module('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (left: unknown, right: unknown) => [left, right],
  inArray: (left: unknown, right: unknown) => [left, right],
  isNotNull: (value: unknown) => value,
}));
mock.module('../../session-service.js', () => ({
  SessionService: {
    getSessionById: async () => ({ campaignId: 'campaign-1', starterCampaignId: 'starter-1' }),
  },
}));
mock.module('../../narrative/narrative-ledger-service.js', () => ({
  NarrativeLedgerService: {
    currentFacts: async () => [
      { subjectName: 'professor emil darkwater', value: { state: 'watching' } },
    ],
  },
}));
mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async () => ({
    entities: [
      {
        id: 'tactical-1',
        slug: 'orc-brute',
        name: 'Orc Brute',
        type: 'monster',
      },
    ],
  }),
}));

const { loadCombatIntentActorRoster } = await import('../combat-intent-roster.js');

describe('loadCombatIntentActorRoster', () => {
  it('combines ledger NPC facts, campaign assets, and tactical entities per request', async () => {
    const roster = await loadCombatIntentActorRoster('session-1', 'user-1');

    expect(roster).toEqual([
      { name: 'Professor Emil Darkwater' },
      { name: 'Orc Brute', actorSlug: 'orc-brute' },
      { name: 'Campaign NPC', actorSlug: 'npc-1' },
      { name: 'Asset NPC', actorSlug: 'asset-npc', monsterId: 'srd:bandit' },
    ]);
  });
});
