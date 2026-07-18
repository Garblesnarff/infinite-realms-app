import { describe, expect, test } from 'bun:test';

import { applyDmHandoutActions } from '../handout-action-service.js';

const persisted = [] as Array<Record<string, unknown>>;
const broadcasts = [] as Array<Record<string, unknown>>;

function dependencies() {
  persisted.length = 0;
  broadcasts.length = 0;
  return {
    sessionId: 'session-1',
    sessionNumber: 3,
    assetCampaignId: 'eternal-feast',
    findAuthored: async (key: string) =>
      key === 'balthazars-recipe'
        ? { key, title: "Balthazar's Recipe", giver: 'Balthazar', body: 'Add rosemary at dawn.' }
        : null,
    listAuthoredKeys: async () => ['balthazars-recipe'],
    persist: async (entry: Record<string, unknown>) => {
      persisted.push(entry);
      return {
        ...entry,
        id: `entry-${persisted.length}`,
        createdAt: '2026-07-17T00:00:00.000Z',
      } as {
        id: string;
        sessionId: string;
        sessionNumber: number;
        mode: 'authored' | 'improvised';
        key: string | null;
        title: string;
        body: string | null;
        giver: string;
        assetPath: string | null;
        createdAt: string;
      };
    },
    broadcast: (entry: Record<string, unknown>) => broadcasts.push(entry),
  };
}

describe('DM handout actions', () => {
  test('retries one unknown authored key and persists only the corrected canon handout', async () => {
    let retries = 0;
    const result = await applyDmHandoutActions(
      [
        {
          mode: 'authored',
          key: 'not-a-real-handout',
          title: 'Recipe',
          body: null,
          giver: 'Balthazar',
        },
      ],
      dependencies(),
      async (refusal) => {
        retries++;
        expect(refusal).toMatchObject({
          reason: 'unknown_handout_key',
          availableKeys: ['balthazars-recipe'],
        });
        return {
          mode: 'authored',
          key: 'balthazars-recipe',
          title: 'Recipe',
          body: null,
          giver: 'Balthazar',
        };
      },
    );
    expect(retries).toBe(1);
    expect(result.degraded).toEqual([]);
    expect(persisted).toEqual([
      expect.objectContaining({
        mode: 'authored',
        key: 'balthazars-recipe',
        assetPath: 'campaigns/eternal-feast/handouts/balthazars-recipe.png',
      }),
    ]);
    expect(broadcasts).toHaveLength(1);
  });

  test('persists and broadcasts an improvised handout without an asset path', async () => {
    const result = await applyDmHandoutActions(
      [
        {
          mode: 'improvised',
          key: null,
          title: 'A Torn Note',
          body: 'Meet me by the old mill.',
          giver: 'The courier',
        },
      ],
      dependencies(),
    );
    expect(result.entries).toHaveLength(1);
    expect(persisted).toEqual([
      expect.objectContaining({
        sessionId: 'session-1',
        sessionNumber: 3,
        mode: 'improvised',
        key: null,
        body: 'Meet me by the old mill.',
        assetPath: null,
      }),
    ]);
    expect(broadcasts).toHaveLength(1);
  });
});
