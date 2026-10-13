/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #467 NT-013: an engine-resolved action-card attack's die never reaches the DM message
 * flow, so logIncomingRolls never writes its roll_result — the narration repair would see
 * no engine outcome. combat-resolution-step.ts now logs the engine's authoritative verdict
 * as a roll_result, which is exactly the shape latestRollOutcome reads.
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

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const SERVER_ID = '5d1e0a44-1111-4222-8333-444444444444';
const APPRENTICE = { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' };
const SERVER = { id: SERVER_ID, name: 'Mechanical Server', participantType: 'monster' };

const chillTouchAction = {
  actor_id: APPRENTICE_ID,
  action_type: 'cast_spell',
  target_ids: [SERVER_ID],
  weapon_id: null,
  spell_id: 'chill-touch',
  slot_level: 0,
  movement_feet: 0,
};

/** NT-013's engine verdict: HIT 17+5=22, 8 necrotic damage. */
const CHILL_TOUCH_HIT = {
  hit: true,
  d20: 17,
  attackBonus: 5,
  totalAttackRoll: 22,
  targetAC: 15,
  spellName: 'Chill Touch',
  actorName: 'The Apprentice',
  targetName: 'Mechanical Server',
  finalDamage: 8,
  damageType: 'necrotic',
};

const resolve = (participants: any[], combatActions: unknown[]) =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-467',
    sessionId: 'session-467',
    combatActions,
    declarationText: 'I cast Chill Touch at the mechanical server.',
    aiContext: {},
    conversationHistory: [],
    participants,
    playerInputOrigin: 'action_bar',
  });

describe('action-card attack outcome logging (#467)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({
      text: 'The mechanical server ignores your magical assault, its gears grinding on.',
      narrationSegments: [],
    });
    repairRefusedCombatAction.mockResolvedValue(null);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: SERVER_ID, name: 'Mechanical Server' },
    });
  });

  it('logs the engine verdict as a roll_result after an action-card spell attack resolves', async () => {
    askPlayerForSpellCast.mockResolvedValue({ d20: 17, autoRolled: false, movementOnly: false });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: CHILL_TOUCH_HIT,
      boundary: null,
    });

    await resolve([APPRENTICE, SERVER], [chillTouchAction]);

    expect(appendRollEvent).toHaveBeenCalledTimes(1);
    expect(appendRollEvent).toHaveBeenCalledWith('session-467', {
      kind: 'roll_result',
      payload: {
        success: true,
        total: 22,
        ac: 15,
        requestType: 'attack',
        // describeAttackRoll's exact output for the NT-013 spec, so the repair and the
        // dismissal patterns read the same words the roll prompt showed.
        description: 'Chill Touch spell attack vs Mechanical Server',
        timestamp: expect.any(String),
      },
    });
  });

  it('logs a miss with success false', async () => {
    askPlayerForSpellCast.mockResolvedValue({ d20: 4, autoRolled: false, movementOnly: false });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: { ...CHILL_TOUCH_HIT, hit: false, totalAttackRoll: 9, finalDamage: 0 },
      boundary: null,
    });

    await resolve([APPRENTICE, SERVER], [chillTouchAction]);

    expect(appendRollEvent).toHaveBeenCalledTimes(1);
    const payload = appendRollEvent.mock.calls[0][1].payload;
    expect(payload.success).toBe(false);
    expect(payload.total).toBe(9);
    expect(payload.requestType).toBe('attack');
  });

  it('logs a weapon attack with the engine-named weapon', async () => {
    askPlayerForAttackDie.mockResolvedValue({ d20: 15, autoRolled: false });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: {
        hit: true,
        d20: 15,
        attackBonus: 7,
        totalAttackRoll: 22,
        targetAC: 15,
        actorName: 'The Apprentice',
        targetName: 'Mechanical Server',
        weaponResolution: { resolved: 'Longsword' },
        finalDamage: 9,
        damageType: 'slashing',
      },
      boundary: null,
    });

    await resolve([APPRENTICE, SERVER], [
      {
        actor_id: APPRENTICE_ID,
        action_type: 'attack',
        target_ids: [SERVER_ID],
        weapon_id: 'longsword',
        spell_id: null,
        slot_level: 0,
        movement_feet: 0,
      },
    ]);

    expect(appendRollEvent).toHaveBeenCalledTimes(1);
    const payload = appendRollEvent.mock.calls[0][1].payload;
    expect(payload).toMatchObject({
      success: true,
      total: 22,
      ac: 15,
      requestType: 'attack',
      description: 'Longsword attack vs Mechanical Server',
    });
  });

  it('does not log a saving-throw spell: its result has no attack roll', async () => {
    askPlayerForSpellCast.mockResolvedValue({ d20: 17, autoRolled: false, movementOnly: false });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      // #2391: the server writes a save spell's result in attack vocabulary
      // (hit = failed save), but no attack was rolled.
      result: {
        hit: true,
        totalAttackRoll: 8,
        targetAC: 0,
        spellName: 'Burning Hands',
        actorName: 'The Apprentice',
        targetName: 'Mechanical Server',
        saveAbility: 'dexterity',
        saveRoll: 8,
        saveDC: 13,
        saved: false,
        finalDamage: 5,
        damageType: 'fire',
      },
      boundary: null,
    });

    await resolve([APPRENTICE, SERVER], [
      { ...chillTouchAction, spell_id: 'burning-hands' },
    ]);

    expect(appendRollEvent).not.toHaveBeenCalled();
  });
});
