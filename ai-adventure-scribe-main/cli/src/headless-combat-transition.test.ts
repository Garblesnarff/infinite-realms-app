/**
 * #1779: the headless client, like the browser client, no longer starts combat.
 *
 * The server's turn-pipeline entry gate creates the encounter and rolls initiative before the
 * DM response comes back, so what this file now pins is the reaction: a `start` envelope makes
 * the client treat the fight as live, fetch the board the server already built, and emit map
 * state — without ever issuing a combat-start request of its own.
 *
 * The former "refused combat start" test is gone with the code path it covered: there is no
 * client-issued start left to be refused. Entry failures are now server-side and surface as
 * `combat_entry_failed` telemetry (see `combat-entry-gate.test.ts`).
 */
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

const mapFetch = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(fixture.map), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

describe('fixture headless structured combat bridge', () => {
  it('reads the server-seated encounter, emits map state, and resolves initiative', async () => {
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
    vi.mocked(AIService.chatWithDM).mockResolvedValue(fixture.response as never);
    globalThis.fetch = mapFetch();

    const client = new HeadlessGameClient('fixture-session');
    const events = await client.play('I draw my sword.');

    // Entry is the server's decision, made before this response existed.
    expect(userDataApi.startStructuredCombat).not.toHaveBeenCalled();
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

  it('treats a server-reported combat_entry as the fight being live', async () => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: 'pc-1',
      campaign: {},
      character: { id: 'pc-1', name: 'Rook' },
    } as never);
    // No transition on the envelope at all — only the server's own report of what it did.
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      ...fixture.response,
      combat_transition: 'none',
      combat_entry: {
        entered: true,
        encounterId: 'encounter-1',
        trigger: 'attack_roll_request',
        detail: 'roll_request attack: strike the goblin',
        sceneSpecSynthesized: true,
      },
    } as never);
    globalThis.fetch = mapFetch();

    const client = new HeadlessGameClient('fixture-session');
    const events = await client.play('I punch the nearest living thing.');

    expect(userDataApi.startStructuredCombat).not.toHaveBeenCalled();
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'map_state' })]),
    );
  });
});
