import { afterEach, describe, expect, it, vi } from 'vitest';

import { dispatchMapActions } from '../../server-bun/src/tactical/dispatch';
import { AIService } from '../../src/services/ai-service';
import { HeadlessGameClient } from '../../src/services/headless-game-client';
import { userDataApi } from '../../src/services/user-data-api';
import fixture from '../fixtures/combat-movement.json';

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

const positionOf = (event: { type: string }, entityId: string): { x: number; y: number } => {
  const map = (event as { map: TacticalMap }).map;
  const entity = map.entities.find((candidate) => candidate.id === entityId)!;
  return { x: entity.x, y: entity.y };
};

/**
 * The regression this guards: two full playtest encounters produced 28 map frames with
 * every entity frozen in place. Here the DM emits map_actions, the real engine dispatcher
 * applies them to the served map, and the assertion is simply that the board moves.
 */
describe('fixture headless combat movement', () => {
  it('moves entities across a scripted combat instead of narrating over a static board', async () => {
    // One mutable board stands in for the server: the DM's actions go through the real
    // engine dispatcher, and every subsequent map fetch sees the result.
    const board = structuredClone(fixture.map) as TacticalMap;

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: 'seeker',
      campaign: {},
      character: { id: 'seeker', name: 'The Seeker' },
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
                id: 'seeker',
                name: 'The Seeker',
                participantType: 'player',
                initiative: 18,
                isCurrent: true,
                hasGone: false,
              },
              {
                id: 'void-maw',
                name: 'Void-Maw',
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
    for (const turn of fixture.turns) {
      vi.mocked(AIService.chatWithDM).mockResolvedValue(turn.response as never);
      const events = await client.play(turn.input);
      const mapState = events.find((event) => event.type === 'map_state');
      expect(mapState).toBeDefined();
      frames.push(mapState as { type: string });
    }

    expect(userDataApi.applyDmTacticalActions).toHaveBeenCalledTimes(2);
    // The monster closes on its turns: 7,7 → 3,3 → 2,2.
    expect(positionOf(frames[0], 'void-maw')).toEqual({ x: 3, y: 3 });
    expect(positionOf(frames[1], 'void-maw')).toEqual({ x: 2, y: 2 });
    expect(positionOf(frames[1], 'void-maw')).not.toEqual(positionOf(frames[0], 'void-maw'));
    // And the PC is not welded to its starting cell either.
    expect(positionOf(frames[1], 'seeker')).toEqual({ x: 1, y: 2 });

    // Closing the gap is what makes the melee attack legal: the pair ends adjacent.
    const finalMap = (frames[1] as unknown as { map: TacticalMap }).map;
    const seeker = finalMap.entities.find((entity) => entity.id === 'seeker')!;
    const voidMaw = finalMap.entities.find((entity) => entity.id === 'void-maw')!;
    expect(Math.max(Math.abs(seeker.x - voidMaw.x), Math.abs(seeker.y - voidMaw.y)) * 5).toBe(5);

    // The whole order reaches the CLI, monsters included.
    expect(
      (frames[1] as unknown as { initiative: Array<{ name: string }> }).initiative.map(
        (entry) => entry.name,
      ),
    ).toEqual(['The Seeker', 'Void-Maw']);
  });
});
