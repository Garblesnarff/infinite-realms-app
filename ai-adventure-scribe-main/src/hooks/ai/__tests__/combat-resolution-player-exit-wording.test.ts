/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDeclaredCombatActions } from '../combat-resolution-step';

/**
 * #749, through the real caller path: the DM's `combat_actions` are handed to the real
 * `executeStructuredCombatActionWithBoundary`, which forwards the player's own words as
 * `playerInput`. The check itself now lives on the server, so this test asserts the wording
 * reaches the request body for a player action — not that the client withholds the intent.
 */
vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(async (): Promise<{ text: string }> => ({ text: 'The fight goes on.' })),
  },
}));

const PLAYER_ID = '8eeac28d-0000-4000-8000-000000000001';
const NPC_ID = 'b962bd05-0000-4000-8000-000000000002';
const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'Rook', participantType: 'player' },
  { id: NPC_ID, name: 'Professor Umeboshi', participantType: 'monster' },
];

const playerFlee = {
  actor_id: PLAYER_ID,
  action_type: 'flee' as const,
  target_ids: [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const resolve = (playerMessage: string) =>
  resolveDeclaredCombatActions({
    encounterId: 'encounter-1',
    combatActions: [playerFlee],
    declarationText: 'You move as the fight continues.',
    aiContext: { gameState: { isInCombat: true } },
    conversationHistory: [],
    participants: PARTICIPANTS,
    playerInputOrigin: 'typed',
    playerMessage,
  });

const sentBody = (): any => JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);

/** The server's answer for a player exit its owner's words did not support (#749). */
const stubSkippedExit = (): void => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result: { skipped: 'exit_without_player_wording' } }),
  })) as unknown as typeof fetch;
};

/** The server accepted the exit and ended the turn, so the batch also crosses the boundary. */
const stubAcceptedExit = (): void => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ result: {} }),
  })) as unknown as typeof fetch;
};

describe('a DM-declared flee carries the player words (#749)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it.each([
    'I back away slowly, keeping my dagger hand up, edging back toward Kaelen.',
    'I step back.',
    'I edge toward Kaelen.',
  ])(
    'forwards free-text movement unchanged, for the server to judge: %s',
    async (playerMessage) => {
      // The server will not stand a DM-declared exit on these words, so it answers with the skip
      // marker: one request, no boundary turn, and the player's words travelled with it.
      stubSkippedExit();

      await resolve(playerMessage);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(sentBody().intent).toMatchObject({ type: 'flee', actorId: PLAYER_ID });
      expect(sentBody().playerInput).toBe(playerMessage);
    },
  );

  it('forwards the words with an explicit flee', async () => {
    stubAcceptedExit();

    await resolve('I flee!');

    expect(sentBody().intent).toMatchObject({ type: 'flee', actorId: PLAYER_ID });
    expect(sentBody().playerInput).toBe('I flee!');
    expect((globalThis.fetch as any).mock.calls[0][0]).toContain('/v1/combat/encounter-1/intent');
  });

  it('keeps the turn open when the server skips the exit for missing wording', async () => {
    stubSkippedExit();

    const resolved = await resolve('I step back.');

    // The client sent the action and the server refused it as a no-op; the batch still
    // resolves (the turn stays open) rather than throwing or reporting an outcome.
    expect(resolved).toBeDefined();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
