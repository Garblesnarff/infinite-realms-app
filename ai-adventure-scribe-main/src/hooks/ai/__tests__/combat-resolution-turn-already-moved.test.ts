/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDeclaredCombatActions } from '../combat-resolution-step';

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

const resolve = () =>
  resolveDeclaredCombatActions({
    encounterId: 'encounter-1',
    combatActions: [playerFlee],
    declarationText: 'You move as the fight continues.',
    aiContext: { gameState: { isInCombat: true } },
    conversationHistory: [],
    participants: PARTICIPANTS,
    playerInputOrigin: 'typed',
    playerMessage: 'I flee!',
  });

describe('turn already moved (#1169)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  const stubFetch = () => {
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      const body = JSON.parse(init?.body ?? '{}');
      if (body.intent?.type === 'flee') {
        return { ok: true, status: 200, json: async () => ({ result: {} }) } as any;
      }
      if (body.intent?.type === 'end_turn') {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: 'Actor is not the current-turn participant',
            details: { currentParticipantId: NPC_ID },
          }),
        } as any;
      }
      return { ok: true, status: 200, json: async () => ({ result: {} }) } as any;
    }) as unknown as typeof fetch;
  };

  it('resolves without throwing, and fetch was called for both flee and end_turn', async () => {
    stubFetch();
    await resolve();
    const calls = (globalThis.fetch as any).mock.calls;
    expect(calls.length).toBe(2);
    const types = calls.map((c: any) => JSON.parse(c[1].body).intent.type);
    expect(types).toContain('flee');
    expect(types).toContain('end_turn');
    const endTurnCall = calls.find((c: any) => JSON.parse(c[1].body).intent.type === 'end_turn');
    expect(JSON.parse(endTurnCall[1].body)).toMatchObject({
      intent: { type: 'end_turn', actorId: PLAYER_ID, actionId: expect.any(String) },
      source: 'dm',
    });
  });
});
