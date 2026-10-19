/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDeclaredCombatActions } from '../combat-resolution-step';

/**
 * #749, through the real caller path: the DM's `combat_actions` are handed to the real
 * `executeStructuredCombatActionWithBoundary`, which is where a player exit is gated on the
 * player's own words. Only the network is stubbed, so the assertion is that no flee intent ever
 * reaches the wire — not that some mock was called a particular way.
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

describe('a DM-declared flee follows the player words (#749)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: {} }),
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it.each([
    'I back away slowly, keeping my dagger hand up, edging back toward Kaelen.',
    'I step back.',
    'I edge toward Kaelen.',
  ])('never sends the flee intent for movement: %s', async (playerMessage) => {
    await resolve(playerMessage);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends the flee intent when the player explicitly flees', async () => {
    await resolve('I flee!');

    const intents: Array<{ url: string; body: { intent?: { type?: string } } }> = (
      globalThis.fetch as any
    ).mock.calls.map(([url, init]: [string, { body: string }]) => ({
      url: String(url),
      body: JSON.parse(init.body),
    }));
    const flee = intents.find(({ body }) => body.intent?.type === 'flee');
    expect(flee).toBeDefined();
    expect(flee?.url).toContain('/v1/combat/encounter-1/intent');
    expect(flee?.body.intent).toMatchObject({ type: 'flee', actorId: PLAYER_ID });
  });
});
