import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchMapActions } from '../../server-bun/src/tactical/dispatch';
import { buildTacticalDigest } from '../../server-bun/src/tactical/tactical-context';
import { AIService } from '../../src/services/ai-service';
import { HeadlessGameClient } from '../../src/services/headless-game-client';
import { userDataApi } from '../../src/services/user-data-api';
import fixture from '../fixtures/combat-slug-identity.json';

import type { MapAction } from '../../server-bun/src/tactical/dispatch';
import type { TacticalMap } from '../../server-bun/src/tactical/types';

vi.mock('@/hooks/ai/ai-utils', () => ({
  buildAIContext: vi.fn((input) => ({
    sessionId: input.sessionId,
    gameState: { isInCombat: input.isInCombat },
  })),
}));
vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn(async ({ existingRequests }) => ({
    playerRollRequests: existingRequests,
    npcRollResults: [],
  })),
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    saveSessionMessages: vi.fn(async () => ({})),
    updateSession: vi.fn(async () => ({})),
    startStructuredCombat: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    getActiveCombat: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

const SEEKER_UUID = '3f1c9a72-8d4b-4c21-9e77-2b6f0a5d1e33';
const ROACH_UUID = 'a71e4d05-6c92-4f18-b3aa-90e7c2418d64';

const mapOf = (event: { type: string }): TacticalMap => (event as { map: TacticalMap }).map;
const positionOf = (event: { type: string }, id: string): { x: number; y: number } => {
  const entity = mapOf(event).entities.find((candidate) => candidate.id === id)!;
  return { x: entity.x, y: entity.y };
};
const chebyshevFeet = (map: TacticalMap): number => {
  const a = map.entities.find((entity) => entity.id === SEEKER_UUID)!;
  const b = map.entities.find((entity) => entity.id === ROACH_UUID)!;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 5;
};

/**
 * The regression this guards is run 6: the board keyed entities by UUID while the DM
 * addressed them in digest slugs, every move failed an exact-match lookup, and thirty turns
 * of narrated combat left the pieces on their spawn cells. Here the DM's slug-addressed
 * actions — including the underscore spelling and the article-dropped "seeker" — go through
 * the real engine dispatcher, and the assertion is that the UUID-keyed board actually moves.
 */
describe('fixture headless combat with slug-addressed DM actions', () => {
  it('applies slug-addressed moves to a UUID-keyed board and closes the digest distance', async () => {
    const board = structuredClone(fixture.map) as TacticalMap;

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: SEEKER_UUID,
      campaign: {},
      character: { id: SEEKER_UUID, name: 'The Seeker' },
    } as never);
    vi.mocked(userDataApi.applyDmTacticalActions).mockImplementation(
      async (_sessionId, actions) => {
        const results = dispatchMapActions(board, actions as unknown as MapAction[]);
        return new Response(JSON.stringify({ results }), { status: 200 });
      },
    );
    vi.mocked(userDataApi.getActiveCombat).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            initiativeOrder: [
              {
                id: SEEKER_UUID,
                name: 'The Seeker',
                participantType: 'player',
                initiative: 18,
                isCurrent: true,
                hasGone: false,
              },
              {
                id: ROACH_UUID,
                name: 'Shadow Roach',
                participantType: 'monster',
                initiative: 14,
                isCurrent: false,
                hasGone: false,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const client = new HeadlessGameClient('fixture-session');
    const frames: Array<{ type: string }> = [];
    const digests: string[] = [];
    for (const turn of fixture.turns) {
      vi.mocked(AIService.chatWithDM).mockResolvedValue(turn.response as never);
      const events = await client.play(turn.input);
      const mapState = events.find((event) => event.type === 'map_state');
      expect(mapState).toBeDefined();
      frames.push(mapState as { type: string });
      digests.push(buildTacticalDigest(mapOf(mapState as { type: string })));
    }

    expect(userDataApi.applyDmTacticalActions).toHaveBeenCalledTimes(2);

    // Coordinates change across frames: "shadow-roach-1", then "shadow_roach_1", then the
    // article-dropped "seeker" — three spellings, one entity each, all applied.
    expect(positionOf(frames[0], ROACH_UUID)).toEqual({ x: 3, y: 3 });
    expect(positionOf(frames[1], ROACH_UUID)).toEqual({ x: 2, y: 2 });
    expect(positionOf(frames[1], ROACH_UUID)).not.toEqual(positionOf(frames[0], ROACH_UUID));
    expect(positionOf(frames[1], SEEKER_UUID)).toEqual({ x: 1, y: 2 });

    // Digest distances shrink turn over turn, ending at the reach the melee needed.
    expect(chebyshevFeet(mapOf(frames[0]))).toBe(10);
    expect(chebyshevFeet(mapOf(frames[1]))).toBe(5);
    expect(digests[0]).toContain('shadow-roach-1|Shadow Roach@3,3');
    expect(digests[0]).toContain('the-seeker:10ft');
    expect(digests[1]).toContain('the-seeker:5ft');
    expect(digests[1]).toContain('/melee');
    // The DM never sees a UUID, on any turn.
    for (const digest of digests) {
      expect(digest).not.toContain(SEEKER_UUID);
      expect(digest).not.toContain(ROACH_UUID);
    }

    expect(
      (frames[1] as unknown as { initiative: Array<{ name: string }> }).initiative.map(
        (entry) => entry.name,
      ),
    ).toEqual(['The Seeker', 'Shadow Roach']);
  });

  it('refuses an unresolvable entity with the roster instead of silently dropping it', async () => {
    const board = structuredClone(fixture.map) as TacticalMap;
    const before = board.entities.map((entity) => ({ x: entity.x, y: entity.y }));
    const [result] = dispatchMapActions(board, [
      { action: 'move', entityId: 'shadow-wraith', x: 3, y: 3, changes: null },
    ]);
    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.refusal.reason).toBe('unknown_entity');
    expect(result.refusal.message).toBe(
      "no entity 'shadow-wraith'; current entities: the-seeker@1,1, shadow-roach-1@7,7",
    );
    expect(board.entities.map((entity) => ({ x: entity.x, y: entity.y }))).toEqual(before);
  });
});
