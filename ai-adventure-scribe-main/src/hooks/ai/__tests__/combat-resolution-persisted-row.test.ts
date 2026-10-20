/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';

/**
 * #570: a DM-declared player action that ends the fight now comes back with the
 * actor's engine row already persisted by the server (so the Victory notice
 * could be posted behind the blow). The resolution step must not append the
 * same action parts to the DM reply as an engine block — the row is the
 * transcript record, and the reply would print the blow twice.
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const askPlayerForAttackDie = vi.fn();
const askPlayerForSpellCast = vi.fn();
const appendRollEvent = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: (...args: any[]) => repairRefusedCombatAction(...args),
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) =>
    executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));
vi.mock('@/services/combat/player-spell-cast', () => ({
  askPlayerForSpellCast: (...args: any[]) => askPlayerForSpellCast(...args),
}));
vi.mock('@/services/session-state-service', () => ({
  SessionStateService: {
    appendRollEvent: (...args: any[]) => appendRollEvent(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const HERO_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const GOLEM_ID = '5d1e0a44-1111-4222-8333-444444444444';
const HERO = { id: HERO_ID, name: 'The Hero', participantType: 'player' };
const GOLEM = { id: GOLEM_ID, name: 'Clay Golem', participantType: 'monster' };
const PARTICIPANTS = [HERO, GOLEM] as any[];

const attackAction = {
  actor_id: HERO_ID,
  action_type: 'attack',
  target_ids: [GOLEM_ID],
  weapon_id: 'longsword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/** The engine's verdict for the killing swing, as the intent route returns it. */
const KILL_RESULT = {
  hit: true,
  d20: 15,
  attackBonus: 7,
  totalAttackRoll: 22,
  targetAC: 12,
  actorName: 'The Hero',
  targetName: 'Clay Golem',
  weaponResolution: { resolved: 'Longsword' },
  finalDamage: 9,
  damageType: 'slashing',
  targetNewHp: 0,
  targetIsConscious: false,
  combatEnded: true,
  endedReason: 'last_hostile_defeated',
};

/** The actor's row as the server's writeNpcEngineRow stores and returns it. */
const persistedPlayerRow = () => {
  const message = buildNpcEngineMessage(
    PARTICIPANTS,
    1,
    { type: 'attack', actorId: HERO_ID, targetIds: [GOLEM_ID] },
    KILL_RESULT,
  );
  return {
    id: 'row-kill',
    sequence: 42,
    text: message.text,
    kind: 'player',
    actionId: 'kill-action',
    sessionId: 'session-570',
    timestamp: new Date().toISOString(),
    context: { ...message.context, npcResult: KILL_RESULT, combatEncounterId: 'enc-570' },
  };
};

const resolve = (combatActions: unknown[]) =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-570',
    sessionId: 'session-570',
    combatActions,
    declarationText: 'I strike the golem with my longsword.',
    aiContext: {},
    conversationHistory: [],
    participants: PARTICIPANTS,
    playerInputOrigin: 'typed',
  });

describe('a declared killing action whose row the server persisted (#570)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({ text: 'The golem crumbles.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: HERO_ID, name: 'The Hero' },
    });
    askPlayerForAttackDie.mockResolvedValue({ d20: 15, autoRolled: false, movementOnly: false });
  });

  it('appends no engine block for the blow: the persisted row is the record', async () => {
    const row = persistedPlayerRow();
    expect(row.text).toContain('Combat ended');
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: GOLEM_ID, hit: true, finalDamage: 9, newHp: 0 }],
      result: { ...KILL_RESULT, engineRows: [row] },
      boundary: 'combat_ended',
    });

    const resolved = await resolve([attackAction]);

    const blocks = (resolved as any).combatEngineBlocks ?? [];
    const lines = blocks.flatMap((block: any) => block.lines ?? []);
    expect(lines.some((line: string) => line.includes('Clay Golem'))).toBe(false);
    // The action is still recorded for the narration pass — only the duplicate
    // transcript block is skipped.
    expect(chatWithDM).toHaveBeenCalled();
  });

  it('appends the engine block as before when no row was persisted (control)', async () => {
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: GOLEM_ID, hit: true, finalDamage: 9, newHp: 0 }],
      result: { ...KILL_RESULT },
      boundary: 'combat_ended',
    });

    const resolved = await resolve([attackAction]);

    const blocks = (resolved as any).combatEngineBlocks ?? [];
    const lines = blocks.flatMap((block: any) => block.lines ?? []).join('\n');
    expect(lines).toContain('Clay Golem');
  });
});
