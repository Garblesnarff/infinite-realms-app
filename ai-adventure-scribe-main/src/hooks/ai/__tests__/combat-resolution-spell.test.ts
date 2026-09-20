/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const askPlayerForAttackDie = vi.fn();
const askPlayerForSpellCast = vi.fn();
const advanceNpcTurns = vi.fn();

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
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));
vi.mock('@/services/combat/player-spell-cast', () => ({
  askPlayerForSpellCast: (...args: any[]) => askPlayerForSpellCast(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');
const logger = (await import('@/lib/logger')).default;

const PLAYER_ID = '8eeac28d-0000-4000-8000-000000000001';
const NPC_ID = 'b962bd05-0000-4000-8000-000000000002';
const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'Rook', participantType: 'player' },
  { id: NPC_ID, name: 'Professor Umeboshi', participantType: 'monster' },
];

const spellAction = (spellId: string) => ({
  actor_id: PLAYER_ID,
  action_type: 'cast_spell',
  target_ids: [NPC_ID],
  weapon_id: null,
  spell_id: spellId,
  slot_level: null,
  movement_feet: 0,
});

describe('player spell resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askPlayerForSpellCast.mockResolvedValue({ autoRolled: true, movementOnly: false });
    askPlayerForAttackDie.mockResolvedValue(null);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: NPC_ID, name: 'Professor Umeboshi' },
    });
    advanceNpcTurns.mockResolvedValue({
      results: [],
      currentParticipant: { id: NPC_ID, name: 'Professor Umeboshi' },
      combatEnded: false,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    });
    chatWithDM.mockResolvedValue({ text: 'The mote of fire flies.', narrationSegments: [] });
  });

  it('asks for the spell popup then renders the engine line, not a client-invented hit', async () => {
    askPlayerForSpellCast.mockResolvedValue({ d20: 17, autoRolled: false, movementOnly: false });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 6 }],
      result: {
        results: [
          {
            actorName: 'Rook',
            targetName: 'Professor Umeboshi',
            spellName: 'Fire Bolt',
            d20: 17,
            attackBonus: 5,
            totalAttackRoll: 22,
            targetAC: 12,
            hit: true,
            finalDamage: 6,
            damageType: 'fire',
          },
        ],
      },
      boundary: null,
    });

    const result = await resolveDeclaredCombatActions({
      encounterId: 'enc-1',
      sessionId: 'session-1',
      combatActions: [spellAction('fire-bolt')],
      declarationText: 'I cast Fire Bolt at Professor Umeboshi.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(askPlayerForSpellCast).toHaveBeenCalledWith(
      expect.objectContaining({ action: spellAction('fire-bolt'), actorLabel: 'Rook' }),
    );
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'enc-1',
      spellAction('fire-bolt'),
      17,
    );
    expect(askPlayerForAttackDie).not.toHaveBeenCalled();
    expect(result.text).toContain(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 17 + 5 = 22 vs AC 12 — HIT. 6 fire damage.',
    );
    expect(result.text).not.toContain('wounded');
  });

  it('submits a save-spell card without a player d20', async () => {
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 4 }],
      result: {
        results: [
          {
            actorName: 'Rook',
            targetName: 'Professor Umeboshi',
            spellName: 'Acid Splash',
            saveAbility: 'DEX',
            saveRoll: 9,
            saveDC: 13,
            saved: false,
            finalDamage: 4,
            damageType: 'acid',
          },
        ],
      },
      boundary: null,
    });

    await resolveDeclaredCombatActions({
      encounterId: 'enc-1',
      sessionId: 'session-1',
      combatActions: [spellAction('acid-splash')],
      declarationText: 'I cast Acid Splash at Professor Umeboshi.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(askPlayerForSpellCast).toHaveBeenCalledWith(
      expect.objectContaining({ action: spellAction('acid-splash'), actorLabel: 'Rook' }),
    );
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'enc-1',
      spellAction('acid-splash'),
      undefined,
    );
  });

  it('renders the refusal line and logs PLAYER_ACTION_UNRESOLVED when the engine refuses the spell', async () => {
    executeStructuredCombatActionWithBoundary.mockRejectedValue(
      new CombatIntentRefusedError('Spell refused: unknown spell "Meteor Swarm"', 422),
    );
    repairRefusedCombatAction.mockResolvedValue(null);
    chatWithDM.mockResolvedValue({ text: 'Nothing happens.', narrationSegments: [] });

    const result = await resolveDeclaredCombatActions({
      encounterId: 'enc-1',
      combatActions: [spellAction('meteor-swarm')],
      declarationText: 'I cast Meteor Swarm.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(logger.warn).toHaveBeenCalledWith('PLAYER_ACTION_UNRESOLVED', {
      actionType: 'cast_spell',
      spell: 'Meteor Swarm',
    });
    expect(result.text).toContain(
      'Rook\'s spell "Meteor Swarm" was refused (Spell refused: unknown spell "Meteor Swarm"). No roll, no damage, no wound.',
    );
    expect(result.text).not.toContain('wounded');
  });
});
