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

  // Migrated (#2658 step 3): was "prints one line for one cast when a refused spell is retried and accepted (#2303)".
  // The client's refuse-recover-retry is gone: the server runs the stale holder before the cast
  // (the intent route's pre-drain, proven on the real route in npc-engine-rows.real-db.test.ts)
  // and returns those creature turns as `npcTurns` on the cast's own result. This pins what the
  // client does with them: the DM hears the creature's turn before the cast, and the cast once.
  it('hands the DM the pre-drained creature turn before the one cast (#2303)', async () => {
    // Run 13 printed REFUSED and then HIT for one Chill Touch: the retry dropped the refusal
    // record but left its engine line in the transcript.
    const chillTouchHit = {
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 3 }],
      result: {
        results: [
          {
            actorName: 'Rook',
            targetName: 'Professor Umeboshi',
            spellName: 'Chill Touch',
            d20: 10,
            attackBonus: 6,
            totalAttackRoll: 16,
            targetAC: 15,
            hit: true,
            finalDamage: 3,
            damageType: 'necrotic',
          },
        ],
      },
      boundary: null,
    };
    // Shaped like the intent route's `result.npcTurns` (intents.ts, from runNpcTurnsIfNpcHolds):
    // one NpcTurnOutcome as npc-turn-runner.ts pushes it, and the turn handed back to the player.
    chillTouchHit.result = {
      ...chillTouchHit.result,
      npcTurns: {
        results: [
          {
            action: {
              actor_id: NPC_ID,
              action_type: 'attack',
              target_ids: [PLAYER_ID],
              weapon_id: null,
              spell_id: null,
              slot_level: null,
              movement_feet: 0,
            },
            round: 1,
            outcomes: [{ participantId: PLAYER_ID, hit: false }],
            engineResult: {
              actorName: 'Professor Umeboshi',
              targetName: 'Rook',
              hit: false,
              d20: 4,
            },
            actorIsPlayer: false,
            transcriptLines: [],
          },
        ],
        currentParticipant: { id: PLAYER_ID, name: 'Rook', participantType: 'player' },
        round: 1,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      },
    } as never;
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce(chillTouchHit);
    chatWithDM.mockResolvedValue({ text: 'A cold hand closes.', narrationSegments: [] });

    const result = await resolveDeclaredCombatActions({
      encounterId: 'enc-1',
      sessionId: 'session-1',
      combatActions: [spellAction('chill-touch')],
      declarationText: 'I cast Chill Touch.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(result.text).not.toContain('was refused');
    expect(result.text.match(/Chill Touch/g)).toHaveLength(1);
    expect(result.text).toContain('Rook cast Chill Touch at Professor Umeboshi');
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    const told = JSON.parse(chatWithDM.mock.calls[0][0].message);
    expect(
      told.authoritativeCombatResults.map(
        (entry: { action: { actor_id: string } }) => entry.action.actor_id,
      ),
    ).toEqual([NPC_ID, PLAYER_ID]);
  });
});
