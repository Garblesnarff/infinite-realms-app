import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '../../src/services/ai-service';
import { HeadlessGameClient } from '../../src/services/headless-game-client';
import { userDataApi } from '../../src/services/user-data-api';
import fixture from '../fixtures/combat-start.json';

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
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    saveSessionMessages: vi.fn(async () => ({})),
    updateSession: vi.fn(async () => ({})),
    startStructuredCombat: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('fixture headless structured combat bridge', () => {
  it('starts server combat, creates the map, emits map state, and resolves initiative', async () => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: 'pc-1',
      campaign: {},
      character: {
        id: 'pc-1',
        name: 'Rook',
        abilityScores: { dexterity: { score: 16, modifier: 3 } },
      },
    } as never);
    vi.mocked(userDataApi.startStructuredCombat).mockResolvedValue(
      new Response(JSON.stringify({ encounter: { id: 'encounter-1' } }), { status: 201 }),
    );
    vi.mocked(AIService.chatWithDM).mockResolvedValue(fixture.response as never);
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(fixture.map), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const client = new HeadlessGameClient('fixture-session');
    const events = await client.play('I draw my sword.');

    expect(userDataApi.startStructuredCombat).toHaveBeenCalledWith(
      'fixture-session',
      expect.objectContaining({
        participants: [
          expect.objectContaining({ characterId: 'pc-1', name: 'Rook', initiativeModifier: 3 }),
          expect.objectContaining({ name: 'Goblin 1' }),
          expect.objectContaining({ name: 'Goblin 2' }),
        ],
        sceneSpec: fixture.response.scene_spec,
      }),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'roll_request' }),
        expect.objectContaining({ type: 'map_state', map: fixture.map }),
      ]),
    );
    const roll = client.roll();
    expect(roll.skipped).toBe(false);
    if (!roll.skipped) expect(roll.result.expression).toContain('1d20+3');
  });
});
