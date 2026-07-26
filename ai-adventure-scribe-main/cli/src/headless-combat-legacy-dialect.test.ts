import { afterEach, describe, expect, it, vi } from 'vitest';

import { planApproach } from '../../server-bun/src/tactical/approach';
import { dispatchMapAction } from '../../server-bun/src/tactical/dispatch';
import { getDistance } from '../../server-bun/src/tactical/engine';
import { translateLegacyAttackRolls } from '../../server-bun/src/tactical/legacy-attack-translation';
import { buildTacticalPrompt } from '../../server-bun/src/tactical/prompt';
import { MELEE_REACH_FEET } from '../../server-bun/src/tactical/spatial-contract';
import { AIService } from '../../src/services/ai-service';
import { HeadlessGameClient } from '../../src/services/headless-game-client';
import { userDataApi } from '../../src/services/user-data-api';
import fixture from '../fixtures/combat-legacy-dialect.json';

import type { DMResponse } from '../../server-bun/src/services/dm/dm-response-schema';
import type { MapEntity, TacticalMap } from '../../server-bun/src/tactical/types';

vi.mock('@/hooks/ai/ai-utils', () => ({
  buildAIContext: vi.fn((input) => ({
    sessionId: input.sessionId,
    gameState: { isInCombat: input.isInCombat, encounterId: 'enc-legacy' },
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

const entityOf = (map: TacticalMap, id: string): MapEntity =>
  map.entities.find((entity) => entity.id === id)!;

/** Open floor; the fixture carries only the roster and the dimensions worth reading. */
const boardFromFixture = (): TacticalMap => {
  const map = structuredClone(fixture.map) as unknown as TacticalMap;
  map.cells = Array.from({ length: map.height }, () =>
    Array.from({ length: map.width }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  );
  return map;
};

/**
 * What the server does between the model and the client, using the server's own modules: the
 * prompt it built, the translation it applies to a legacy attack, and the auto-approach the
 * engine performs before resolving one. Nothing here is a re-implementation — it is the
 * ordering, which lives across two processes and has no other place to be exercised whole.
 */
const serverTurn = (
  board: TacticalMap,
  response: DMResponse & { activeEntityId?: string },
): { delivered: DMResponse; translated: boolean } => {
  const prompt =
    `<tactical_context>\n${buildTacticalPrompt(board, response.activeEntityId)}\n</tactical_context>\n` +
    '<immutable_game_state>{"isInCombat":true,"encounterId":"enc-legacy"}</immutable_game_state>';
  const translation = translateLegacyAttackRolls(response, prompt, true);
  const delivered = translation?.response ?? response;

  // Every attack that reaches the engine is approached first: this is what turns a declared
  // intent into a change of coordinates.
  for (const action of delivered.combat_actions) {
    if (!('target_ids' in action) || action.action_type !== 'attack') continue;
    const target = action.target_ids[0];
    if (!target) continue;
    const plan = planApproach(board, action.actor_id, target, MELEE_REACH_FEET);
    if (!plan) continue;
    dispatchMapAction(board, {
      action: 'move',
      entityId: action.actor_id,
      x: plan.destination.x,
      y: plan.destination.y,
      changes: null,
    });
  }
  return { delivered, translated: !!translation };
};

/**
 * The run 8 outcome regression, end to end. The DM speaks nothing but the old dialect for a
 * whole encounter — attacks as `roll_requests`, not one `combat_actions` entry, not one
 * `map_actions` move — which in run 8 meant nothing resolved, nobody moved, and combat had to
 * be force-restarted four times. Here the same transcript closes 40ft, lands its attacks, and
 * reaches a combat end.
 */
describe('fixture headless combat: a whole encounter in the legacy dialect', () => {
  it('translates every attack, moves the board, and reaches combat end', async () => {
    const board = boardFromFixture();
    const startingDistance = getDistance(
      entityOf(board, 'the-seeker'),
      entityOf(board, 'shadow-roach'),
    );
    expect(startingDistance).toBe(40);

    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'fixture-session',
      campaign_id: 'campaign-1',
      character_id: 'the-seeker',
      campaign: {},
      character: { id: 'the-seeker', name: 'The Seeker' },
    } as never);
    vi.mocked(userDataApi.endTacticalMap).mockImplementation(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.mocked(userDataApi.getActiveCombat).mockImplementation(
      async () => new Response(JSON.stringify({ initiativeOrder: [] }), { status: 200 }),
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(board), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const client = new HeadlessGameClient('fixture-session');
    const translations: boolean[] = [];
    const distances: number[] = [];

    for (const turn of fixture.turns) {
      const { delivered, translated } = serverTurn(
        board,
        turn.response as unknown as DMResponse & { activeEntityId?: string },
      );
      translations.push(translated);
      vi.mocked(AIService.chatWithDM).mockResolvedValue(delivered as never);
      const events = await client.play(turn.input);
      expect(events.some((event) => event.type === 'narration')).toBe(true);
      distances.push(getDistance(entityOf(board, 'the-seeker'), entityOf(board, 'shadow-roach')));
    }

    // Both attack turns spoke the old dialect and both were translated; the end turn had
    // nothing to translate.
    expect(translations).toEqual([true, true, false]);

    // The roach closed on its turn, and the gap never reopened: coordinates changed.
    expect(distances[0]).toBeLessThan(startingDistance);
    expect(distances[distances.length - 1]).toBeLessThanOrEqual(MELEE_REACH_FEET);
    expect(entityOf(board, 'shadow-roach')).not.toMatchObject({ x: 9, y: 8 });

    // And the encounter ended the only way it is allowed to: an end transition.
    expect(userDataApi.endTacticalMap).toHaveBeenCalledTimes(1);
    expect(userDataApi.startStructuredCombat).not.toHaveBeenCalled();
  });
});
