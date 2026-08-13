import { describe, expect, test } from 'bun:test';

import { applyDmHandoutActions, buildHandoutPossessionFact } from '../handout-action-service.js';

const persisted = [] as Array<Record<string, unknown>>;
const broadcasts = [] as Array<Record<string, unknown>>;
const recordedFacts = [] as Array<Record<string, unknown>>;

function dependencies() {
  persisted.length = 0;
  broadcasts.length = 0;
  recordedFacts.length = 0;
  return {
    sessionId: 'session-1',
    sessionNumber: 3,
    assetCampaignId: 'eternal-feast',
    recipient: 'The Reveler',
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
        recipient: string;
        mode: 'authored' | 'improvised';
        key: string | null;
        title: string;
        body: string | null;
        giver: string;
        assetPath: string | null;
        createdAt: string;
      };
    },
    recordFact: async (entry: Record<string, unknown>) => {
      recordedFacts.push(entry);
    },
    broadcast: (entry: Record<string, unknown>) => broadcasts.push(entry),
  };
}

describe('DM handout actions', () => {
  test('builds an engine possession fact for the receiving player character', () => {
    expect(
      buildHandoutPossessionFact(
        {
          id: 'entry-1',
          sessionId: 'session-1',
          sessionNumber: 2,
          recipient: 'The Reveler',
          mode: 'improvised',
          key: null,
          title: 'Contained Temporal Soufflé',
          body: 'A souffle held in a pocket of time.',
          giver: 'The Reveler',
          assetPath: null,
          createdAt: '2026-08-12T00:00:00.000Z',
        },
        'The Reveler',
        'session-1',
        'campaign-1',
      ),
    ).toEqual({
      sessionId: 'session-1',
      campaignId: 'campaign-1',
      subjectType: 'party',
      subjectName: 'The Reveler',
      predicate: 'possesses',
      value: {
        name: 'Contained Temporal Soufflé',
        description: 'A souffle held in a pocket of time.',
      },
      knownBy: ['dm', 'player'],
      source: 'engine',
    });
  });

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
    expect(recordedFacts).toEqual([
      expect.objectContaining({ recipient: 'The Reveler', title: 'Recipe' }),
    ]);
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
    expect(recordedFacts).toEqual([
      expect.objectContaining({ recipient: 'The Reveler', title: 'A Torn Note' }),
    ]);
  });
});
