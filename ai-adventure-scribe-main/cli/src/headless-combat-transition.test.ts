import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '../../src/services/ai-service';
import { CombatStartError } from '../../src/services/combat/combat-start-failure';
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
    getActiveCombat: vi.fn(
      async () => new Response(JSON.stringify({ initiativeOrder: [] }), { status: 200 }),
    ),
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
          expect.objectContaining({ name: 'Goblin 1', monsterId: 'srd:goblin' }),
          expect.objectContaining({ name: 'Goblin 2', monsterId: 'srd:goblin' }),
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

  it('reports a refused combat start with the DM envelope, response body, and telemetry', async () => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: 'pc-1',
      campaign: {},
      character: { id: 'pc-1', name: 'Rook' },
    } as never);
    vi.mocked(userDataApi.startStructuredCombat).mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Failed to start combat encounter',
          stage: 'map_generation',
          detail: 'tactical map write failed',
        }),
        { status: 500 },
      ),
    );
    vi.mocked(AIService.chatWithDM).mockImplementation((async (request: {
      onProviderResponse?: (metadata: { provider: string; model: string }) => void;
    }) => {
      request.onProviderResponse?.({ provider: 'openrouter', model: 'mistral-small-creative' });
      return fixture.response;
    }) as never);

    const client = new HeadlessGameClient('fixture-session');
    const failure = await client.play('I draw my sword.').then(
      () => null,
      (error: CombatStartError & { provider?: string; model?: string }) => error,
    );

    expect(failure).toBeInstanceOf(CombatStartError);
    expect(failure).toMatchObject({
      status: 500,
      stage: 'map_generation',
      detail: 'tactical map write failed',
      category: 'transport',
      provider: 'openrouter',
      model: 'mistral-small-creative',
    });
    // The full DM envelope travels with the failure so a transcript can record what was tried.
    expect(failure!.envelope).toEqual(fixture.response);
    expect(failure!.responseBody).toContain('tactical map write failed');
  });
});
