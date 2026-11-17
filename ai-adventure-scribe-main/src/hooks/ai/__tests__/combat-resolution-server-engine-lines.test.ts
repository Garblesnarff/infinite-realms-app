/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NEUTRAL_NO_EFFECT_LINE } from '../narration-gate';

/**
 * #1597 (client proof for the typed combat path): a typed Lay on Hands the server resolved in a
 * fight arrives as `serverEngineLines`. On a silent typed turn (no action the player's own
 * words declared, no combat action), the line must be an engine block of the turn, and the
 * narration must not be replaced by the no-effect line.
 */
const chatWithDM = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: (...args: any[]) => chatWithDM(...args),
    lastRequestId: () => 'req-1597',
  },
  isRollOutcomeStale: () => false,
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: vi.fn(async () => null),
}));
vi.mock('@/services/session-state-service', () => ({
  SessionStateService: { appendRollEvent: vi.fn() },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const HERO_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const PARTICIPANTS = [{ id: HERO_ID, name: 'The Hero', participantType: 'player' }] as any[];

/** The DM narrates a heal the engine's line backs (an outcome the gate checks for). */
const HEALING_REPLY = 'The gash bleeds and you are wounded.';
const ENGINE_LINE =
  'The Hero lays on hands and restores 5 HP to themself. Pool: 0 of 5 HP remaining.';

const resolveSilentTypedTurn = (serverEngineLines?: string[]) =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-1597',
    sessionId: 'session-1597',
    combatActions: [],
    declarationText: 'I use Lay on Hands on myself for 5 hit points.',
    aiContext: {},
    conversationHistory: [],
    participants: PARTICIPANTS,
    playerInputOrigin: 'typed',
    silentPlayerTurn: { playerMessage: 'I use Lay on Hands on myself for 5 hit points.' },
    ...(serverEngineLines ? { serverEngineLines } : {}),
  } as any);

describe('a typed Lay on Hands on a silent turn carries the server engine line (#1597)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({ text: HEALING_REPLY, narrationSegments: [] });
  });

  it('puts the server line in the turn as an engine block', async () => {
    const resolved = await resolveSilentTypedTurn([ENGINE_LINE]);
    const lines = ((resolved as any).combatEngineBlocks ?? [])
      .flatMap((block: any) => block.lines ?? [])
      .join('\n');
    expect(lines).toContain('restores 5 HP');
  });

  it('keeps the DM reply: the no-effect line does not replace it', async () => {
    const resolved = await resolveSilentTypedTurn([ENGINE_LINE]);
    expect((resolved as any).text).not.toContain('Nothing comes of that');
    expect((resolved as any).text).toContain(HEALING_REPLY);
  });

  it('without the server line, the same healing reply is gated (control)', async () => {
    const resolved = await resolveSilentTypedTurn();
    expect((resolved as any).text).toContain(NEUTRAL_NO_EFFECT_LINE);
  });
});
