import { NumberGenerator } from '@dice-roller/rpg-dice-roller';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AIService } from '@/services/ai-service';
import { DiceEngine } from '@/services/dice/DiceEngine';
import { HeadlessGameClient } from '@/services/headless-game-client';
import { userDataApi } from '@/services/user-data-api';

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
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: () => ({}),
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe('HeadlessGameClient asset tag stripping', () => {
  it('strips [ASSET:...] markers from persisted and emitted narration via shared stripAssetTags', async () => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-1',
      campaign_id: 'campaign-1',
      character_id: 'pc-1',
      campaign: {},
      character: { id: 'pc-1', name: 'Rook' },
    } as never);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: '[ASSET:npc:sergeant-vance] Sergeant Vance blocks the door.',
    } as never);
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    const events = await new HeadlessGameClient('session-1').play('I approach the gate.');

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'narration',
          text: 'Sergeant Vance blocks the door.',
        }),
      ]),
    );
    expect(userDataApi.saveSessionMessages).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        speaker_type: 'dm',
        message: 'Sergeant Vance blocks the door.',
      }),
    );
    expect(JSON.stringify(events)).not.toContain('[ASSET:');
  });
});

describe('HeadlessGameClient roll context', () => {
  it('saves the kept die apart from the dropped one on a disadvantage roll', async () => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-1',
      campaign_id: 'campaign-1',
      character_id: 'pc-1',
      campaign: {},
      character: { id: 'pc-1', name: 'Rook' },
    } as never);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: 'The door gives way.' } as never);
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 404 }),
    ) as unknown as typeof fetch;

    // The real producer: faces 18 then 5 on disadvantage, so the extra d20 (5) is kept.
    const engine = NumberGenerator.generator.engine;
    const faces = [18, 5];
    let next = 0;
    NumberGenerator.generator.engine = { next: () => faces[next++] - 1 };
    let result;
    try {
      result = DiceEngine.roll('1d20+5', { disadvantage: true, purpose: 'Athletics check' });
    } finally {
      NumberGenerator.generator.engine = engine;
    }
    const request = {
      type: 'skill_check' as const,
      formula: '1d20+5',
      purpose: 'Athletics check',
      disadvantage: true,
    };

    await new HeadlessGameClient('session-1').play('', [{ skipped: false, request, result }]);

    const playerRow = vi
      .mocked(userDataApi.saveSessionMessages)
      .mock.calls.map(
        ([, row]) => row as { speaker_type: string; context?: { diceRoll?: unknown } },
      )
      .find((row) => row.speaker_type === 'player');
    expect(playerRow?.context?.diceRoll).toMatchObject({
      naturalRoll: 5,
      total: 10,
      disadvantage: true,
      results: [18, 5],
      keptResults: [5],
    });
  });
});
