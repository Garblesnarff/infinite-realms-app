/* eslint-disable max-lines -- one board and one mock harness shared by every wiring assertion. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '../../src/services/ai-service';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatAction,
} from '../../src/services/combat/combat-action-executor';
import { HeadlessGameClient } from '../../src/services/headless-game-client';
import { userDataApi } from '../../src/services/user-data-api';

/**
 * The wiring runs 5-9 never had.
 *
 * Every server-side combat contract — the legacy-attack translator, the prose-intent floor,
 * the spatial check — begins by parsing a `<tactical_context>` block out of the prompt and
 * returns null when there isn't one. The headless client never fetched that block, and it
 * never executed a `combat_action` either: it printed them into a transcript and dropped them.
 *
 * So run 9's two headline measurements were guaranteed before the model spoke a word. "Zero
 * attack roll_requests translated" could not have been anything else, because the translator
 * had no digest to resolve a pair against. "Zero combat_actions ever populated" could not have
 * been anything else, because nothing sent them anywhere. And `<engine_resolved_outcomes>`
 * "never once fired in prod" because the endpoint that emits it was never called.
 *
 * These tests pin all three so the CLI cannot silently stop being a client again.
 */
vi.mock('@/hooks/ai/ai-utils', () => ({
  buildAIContext: vi.fn((input) => ({
    sessionId: input.sessionId,
    gameState: {
      isInCombat: input.isInCombat,
      encounterId: input.encounterId,
      currentTurnPlayerId: input.currentTurnParticipantId,
    },
  })),
}));
vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn(async ({ existingRequests }) => ({
    playerRollRequests: existingRequests,
    npcRollResults: [],
  })),
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeStructuredCombatAction: vi.fn(async () => []),
  executeAuthoritativeCombatIntent: vi.fn(async () => ({})),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSession: vi.fn(async () => ({ turn_count: 0 })),
    listSessionMessages: vi.fn(async () => ({ messages: [] })),
    getSessionContext: vi.fn(),
    saveSessionMessages: vi.fn(async () => ({})),
    updateSession: vi.fn(async () => ({})),
    startStructuredCombat: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    getActiveCombat: vi.fn(),
    getTacticalMapContext: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;

const MAP = {
  id: 'map',
  sessionId: 'fixture-session',
  width: 10,
  height: 10,
  round: 1,
  sceneDescription: 'crypt',
  cells: Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'the-seeker',
      name: 'The Seeker',
      x: 1,
      y: 1,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'shadow-roach-1',
      name: 'Shadow Roach 1',
      x: 6,
      y: 5,
      size: 'medium',
      type: 'monster',
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
};

const TACTICAL_CONTEXT =
  'MAP\nTACTICAL DIGEST\nACTIVE the-seeker\n' +
  'the-seeker|The Seeker@1,1 mv30/30 vs[shadow-roach-1:25ft/LoS/c0/range]\n\n' +
  '<engine_resolved_outcomes>\nThe Seeker attacked Shadow Roach 1: HIT for 7 damage.\n' +
  '</engine_resolved_outcomes>';

const dmResponse = (overrides: Record<string, unknown> = {}) => ({
  text: 'You drive the blade into the roach.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  ...overrides,
});

const attackAction = {
  actor_id: 'the-seeker',
  action_type: 'attack',
  target_ids: ['shadow-roach-1'],
  weapon_id: 'longsword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const startCombatClient = async (): Promise<HeadlessGameClient> => {
  const client = new HeadlessGameClient('fixture-session');
  await client.load();
  return client;
};

beforeEach(() => {
  vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
    id: 'fixture-session',
    campaign_id: 'campaign-1',
    character_id: 'the-seeker',
    campaign: {},
    character: { id: 'the-seeker', name: 'The Seeker' },
  } as never);
  vi.mocked(userDataApi.getActiveCombat).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          combat: { encounter: { id: 'enc-1' } },
          initiativeOrder: [
            {
              id: 'the-seeker',
              name: 'The Seeker',
              participantType: 'player',
              initiative: 18,
              isCurrent: true,
              hasGone: false,
            },
            {
              id: 'shadow-roach-1',
              name: 'Shadow Roach 1',
              participantType: 'npc',
              initiative: 9,
              isCurrent: false,
              hasGone: false,
            },
          ],
        }),
        { status: 200 },
      ),
  );
  vi.mocked(userDataApi.getTacticalMapContext).mockImplementation(
    async () =>
      new Response(JSON.stringify({ tacticalContext: TACTICAL_CONTEXT }), { status: 200 }),
  );
  // `getMap` goes out over raw fetch; an active map is what puts the client in combat.
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(MAP), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('the headless client puts the board in the prompt', () => {
  it('fetches the tactical context for the current-turn participant', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    expect(userDataApi.getTacticalMapContext).toHaveBeenCalledWith('fixture-session', 'the-seeker');
  });

  /**
   * Without this the server's `parseTacticalDigest` returns null on its first line and every
   * combat contract downstream is a no-op — which is precisely what run 9 measured.
   */
  it('hands that context to the DM so a digest reaches the server', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    const context = vi.mocked(AIService.chatWithDM).mock.calls[0][0].context as {
      gameState: { tacticalContext?: string };
    };
    expect(context.gameState.tacticalContext).toContain('TACTICAL DIGEST');
    expect(context.gameState.tacticalContext).toContain('ACTIVE the-seeker');
  });

  it('carries the engine feedback the DM has to narrate', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    const context = vi.mocked(AIService.chatWithDM).mock.calls[0][0].context as {
      gameState: { tacticalContext?: string };
    };
    expect(context.gameState.tacticalContext).toContain('<engine_resolved_outcomes>');
    expect(context.gameState.tacticalContext).toContain('HIT for 7 damage');
  });

  it('identifies the encounter, so the server can teach the dialect once per fight', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    const context = vi.mocked(AIService.chatWithDM).mock.calls[0][0].context as {
      gameState: { encounterId?: string | null };
    };
    expect(context.gameState.encounterId).toBe('enc-1');
  });

  it('asks for no tactical context at all outside combat', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 404 }),
    ) as unknown as typeof fetch;
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I look around the empty hall.');

    expect(userDataApi.getTacticalMapContext).not.toHaveBeenCalled();
  });
});

describe('the headless client executes declared attacks instead of printing them', () => {
  it('sends every targeted combat action to the engine', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(
      dmResponse({ combat_actions: [attackAction] }) as never,
    );
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    expect(executeStructuredCombatAction).toHaveBeenCalledWith('enc-1', attackAction);
  });

  /** Initiative only advances when a turn is ended; a board that never advances is frozen. */
  it('ends the actor turn so initiative advances', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(
      dmResponse({ combat_actions: [attackAction] }) as never,
    );
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'enc-1',
      { type: 'end_turn', actorId: 'the-seeker' },
      'dm',
    );
  });

  it('sends nothing when the DM declared nothing', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmResponse() as never);
    const client = await startCombatClient();
    await client.play('I look at the roach.');

    expect(executeStructuredCombatAction).not.toHaveBeenCalled();
  });

  it('executes each of several declared attacks, in order', async () => {
    const second = { ...attackAction, actor_id: 'shadow-roach-1', target_ids: ['the-seeker'] };
    vi.mocked(AIService.chatWithDM).mockResolvedValue(
      dmResponse({ combat_actions: [attackAction, second] }) as never,
    );
    const client = await startCombatClient();
    await client.play('I attack the roach.');

    expect(vi.mocked(executeStructuredCombatAction).mock.calls.map((call) => call[1])).toEqual([
      attackAction,
      second,
    ]);
  });
});
