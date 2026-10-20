/**
 * #913 (Hetzner fair test, session 598023a8): the DM proposed combat entry on 8 of 10
 * turns and no encounter ever seated. The server's gate did its half every turn — it
 * rewrote the model's start envelope into a `combat_entry_pending` handoff and waited
 * for `POST /v1/combat/sessions/:id/enter`. The browser completes that handoff in
 * `dm-actions-handler` (confirm, roll initiative, `/enter`); the headless client never
 * read the field at all, so its only answer to the pending's initiative request was to
 * roll it as a narrative roll and send the result back as chat text — which seats
 * nothing, and the DM faithfully re-proposed entry next turn.
 *
 * These tests pin the headless client's half of the protocol: a pending entry seats
 * through `/enter` with the rolled d20, the entry's engine-owned roll requests never
 * become narrative rolls, the next turn is played in-encounter, a re-proposal while
 * seated seats nothing twice, and a refused entry fails the turn with the
 * `CombatEntryError` shape the auto-play failure streak already understands
 * (`combat-entry-resilience.test.ts`) instead of looping silently.
 *
 * Producers: every fixture comes from `shared/test-fixtures/combat-entry-headless.ts`
 * (AGENTS.md §4); the server test posts the same `/enter` body through the real route.
 */
import { NumberGenerator } from '@dice-roller/rpg-dice-roller';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HEADLESS_ENTRY_ENCOUNTER_ID,
  HEADLESS_ENTRY_INITIATIVE_ROLL,
  HEADLESS_ENTRY_PLAYER_INPUT,
  HEADLESS_ENTRY_SESSION_ID,
  headlessEntryCharacter,
  headlessEntryDmResponse,
  headlessEntryEnterBody,
  headlessEntryEnterResponse,
} from '../../shared/test-fixtures/combat-entry-headless';
import { AIService } from '../../src/services/ai-service';
import { executeStructuredCombatActionWithBoundary } from '../../src/services/combat/combat-action-executor';
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
vi.mock('@/services/combat/combat-action-executor', () => ({
  combatBoundaryFromResult: vi.fn(() => null),
  executeAuthoritativeCombatIntent: vi.fn(async () => ({})),
  executeStructuredCombatActionWithBoundary: vi.fn(async () => ({ boundary: null })),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    saveSessionMessages: vi.fn(async () => ({})),
    updateSession: vi.fn(async () => ({})),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    enterCombat: vi.fn(),
    getTacticalMapContext: vi.fn(async () => new Response(null, { status: 404 })),
    getActiveCombat: vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            initiativeOrder: headlessEntryEnterResponse.initiativeOrder,
            combat: { encounter: { id: HEADLESS_ENTRY_ENCOUNTER_ID } },
          }),
          { status: 200 },
        ),
    ),
  },
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

/** The dice stub: every d20 face comes back as the fixture's initiative roll. */
const stubInitiativeDie = (): void => {
  NumberGenerator.generator.engine = { next: () => HEADLESS_ENTRY_INITIATIVE_ROLL - 1 };
};

const sessionContext = () =>
  vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
    id: HEADLESS_ENTRY_SESSION_ID,
    campaign_id: 'campaign-1',
    character_id: headlessEntryCharacter.id,
    campaign: {},
    character: headlessEntryCharacter,
  } as never);

const mapFetch = () =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(fixture.map), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  ) as unknown as typeof fetch;

describe('HeadlessGameClient combat entry (#913)', () => {
  it('seats a pending entry through /enter with the rolled initiative, then plays the next turn in-encounter', async () => {
    sessionContext();
    stubInitiativeDie();
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(headlessEntryDmResponse as never)
      .mockResolvedValueOnce({
        text: 'Balthazar circles the pass, cleaver raised.',
        combat_transition: 'none',
        roll_requests: [],
        combat_actions: [],
        map_actions: [],
      } as never);
    vi.mocked(userDataApi.enterCombat).mockImplementation(
      async () =>
        new Response(JSON.stringify(headlessEntryEnterResponse), { status: 201 }),
    );
    globalThis.fetch = mapFetch();

    const client = new HeadlessGameClient(HEADLESS_ENTRY_SESSION_ID);
    const events = await client.play(HEADLESS_ENTRY_PLAYER_INPUT);

    // The exact body the shared fixture holds (AGENTS.md §4), sent exactly once.
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    expect(userDataApi.enterCombat).toHaveBeenCalledWith(
      HEADLESS_ENTRY_SESSION_ID,
      headlessEntryEnterBody,
    );
    // The declared attack the server derived at seating is the action that resolves,
    // not the model's own batch.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      HEADLESS_ENTRY_ENCOUNTER_ID,
      headlessEntryEnterResponse.first_action.combat_action,
    );
    // The entry's initiative request was consumed by the seat: it is not a pending
    // narrative roll, so the next turn needs no roll batch to proceed.
    expect(client.pendingRolls).toEqual([]);
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'map_state' })]),
    );

    await client.play('I strike at Balthazar again.');

    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    const secondTurn = vi.mocked(AIService.chatWithDM).mock.calls[1][0] as {
      context: { gameState: { isInCombat: boolean } };
    };
    expect(secondTurn.context.gameState.isInCombat).toBe(true);
  });

  it('does not seat twice when the DM re-proposes the same entry on the next turn', async () => {
    sessionContext();
    stubInitiativeDie();
    vi.mocked(AIService.chatWithDM).mockResolvedValue(headlessEntryDmResponse as never);
    vi.mocked(userDataApi.enterCombat).mockImplementation(
      async () =>
        new Response(JSON.stringify(headlessEntryEnterResponse), { status: 201 }),
    );
    globalThis.fetch = mapFetch();

    const client = new HeadlessGameClient(HEADLESS_ENTRY_SESSION_ID);
    await client.play(HEADLESS_ENTRY_PLAYER_INPUT);
    await client.play(HEADLESS_ENTRY_PLAYER_INPUT);

    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
  });

  it('fails the turn with a CombatEntryError when the server refuses the entry', async () => {
    sessionContext();
    stubInitiativeDie();
    vi.mocked(AIService.chatWithDM).mockResolvedValue(headlessEntryDmResponse as never);
    vi.mocked(userDataApi.enterCombat).mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: 'Combat entry is no longer available' }), {
          status: 409,
        }),
    );
    globalThis.fetch = mapFetch();

    const client = new HeadlessGameClient(HEADLESS_ENTRY_SESSION_ID);
    const failure = await client.play(HEADLESS_ENTRY_PLAYER_INPUT).catch((error) => error);

    expect(failure).toMatchObject({
      name: 'CombatEntryError',
      category: 'transport',
      status: 409,
      stage: 'entry',
      detail: 'Combat entry is no longer available',
      fingerprint: 'combat_entry:409:entry:Combat entry is no longer available',
    });
    expect(failure.toTranscriptDetail()).toMatchObject({
      kind: 'combat_entry_failure',
      status: 409,
      stage: 'entry',
      detail: 'Combat entry is no longer available',
    });
    expect(failure.toTranscriptDetail().dmEnvelope).toMatchObject({
      combat_entry_pending: { trigger: 'combat_transition' },
    });
  });
});
