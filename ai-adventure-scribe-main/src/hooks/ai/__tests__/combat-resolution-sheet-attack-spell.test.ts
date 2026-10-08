/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dmCantripAoEAction } from '../../../../shared/test-fixtures/cantrip-aoe-cast';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

import { attackModifierForRoll, describeAttackRoll } from '@/hooks/combat/use-player-roll-host';
import {
  setPlayerRollHost,
  type PlayerAttackRollSpec,
  type PlayerRollSpec,
} from '@/services/combat/player-roll-bridge';
import { clearHeldSaveCard, holdSaveCardBeforeDm } from '@/services/combat/sheet-cast-save-hold';
import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';

/**
 * #2343 A1: the sheet's Cast of an attack-roll spell in combat opens the same spell-attack d20
 * prompt, with the caster's own modifier, that a typed cast opens; a save spell keeps its
 * "Target saves" card and no die. Everything from the resolution step down to the roll bridge is
 * real. The edge is stubbed with the answers the real route gives: the proposal body is the full
 * output of `proposeCombatSpell` (combat-intent-service.ts), and `no_area_of_effect` is what the
 * aoe-cast route answers for a spell with no area.
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const resolveAoECast = vi.fn();
const fetchMock = vi.fn();

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
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    resolveAoECast: (...args: any[]) => resolveAoECast(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const SHARD_ID = '5d1e0a44-1111-4222-8333-444444444444';
const APPRENTICE = { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' };
const SHARD = { id: SHARD_ID, name: 'Corrupted Shard', participantType: 'monster' };

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** `proposeCombatSpell`'s whole return for a Chill Touch cast by The Apprentice (+5) at the Shard. */
const CHILL_TOUCH_PROPOSAL = {
  movementOnly: false,
  spellId: 'chill-touch',
  spellName: 'Chill Touch',
  kind: 'attack',
  attackBonus: 5,
  saveDC: 13,
  targetAc: 12,
  advantage: false,
  disadvantage: false,
  actorId: APPRENTICE_ID,
  targetIds: [SHARD_ID],
  expectedVersion: 7,
  targetLabel: 'Corrupted Shard',
};

/** What the DM writes for a sheet Cast of Chill Touch when it names the creature. */
const dmChillTouchAction = {
  actor_id: 'the-apprentice',
  action_type: 'cast_spell' as const,
  target_ids: [SHARD_ID],
  weapon_id: null,
  spell_id: 'chill-touch',
  slot_level: null,
  movement_feet: 0,
};

const CHILL_TOUCH_RESULT = {
  results: [
    {
      actorName: 'The Apprentice',
      targetName: 'Corrupted Shard',
      spellName: 'Chill Touch',
      d20: 14,
      attackBonus: 5,
      totalAttackRoll: 19,
      targetAC: 12,
      hit: true,
      finalDamage: 4,
      damageType: 'necrotic',
    },
  ],
};

const resolve = (combatActions: unknown[], spell: string) =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-2343',
    sessionId: 'session-2343',
    combatActions,
    declarationText: `I cast ${spell} [spell_id=${spell.toLowerCase().replace(' ', '-')}, spell_level=cantrip].`,
    aiContext: {},
    conversationHistory: [],
    participants: [APPRENTICE, SHARD],
    playerInputOrigin: 'sheet_cast',
    declaredPlayerSpell: {
      spellId: spell.toLowerCase().replace(' ', '-'),
      spellName: spell,
    },
  } as any);

describe('the sheet Cast of an attack-roll spell in combat (#2343 A1)', () => {
  const rollPrompts: PlayerRollSpec[] = [];
  const saveCards: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    clearHeldSaveCard();
    rollPrompts.length = 0;
    saveCards.length = 0;
    // The player rolls a natural 14 the moment the prompt appears, and continues the save card.
    setPlayerRollHost({
      present: (spec, settle) => {
        rollPrompts.push(spec);
        settle({ d20: 14 });
        return { rollId: 'roll-1', dismiss: () => {} };
      },
    });
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        saveCards.push(spec);
        settle();
        return () => {};
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      jsonResponse(200, { accepted: true, proposal: CHILL_TOUCH_PROPOSAL }),
    );
    chatWithDM.mockResolvedValue({ text: 'The cold hand finds it.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
    // The End turn body: the boundary hands the turn to the shard, and the server runs it before
    // answering (`npcTurns`, the drain's AdvanceNpcTurnsResult shape) — #2658 step 3.
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: SHARD_ID, name: 'Corrupted Shard' },
      engineRows: [],
      npcTurns: {
        results: [],
        currentParticipant: {
          id: APPRENTICE_ID,
          name: 'The Apprentice',
          participantType: 'player',
        },
        round: 1,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      },
    });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: CHILL_TOUCH_RESULT,
      boundary: null,
    });
  });

  it("opens the spell-attack prompt at the caster's +5 and sends the player's die to the engine", async () => {
    const result = await resolve([dmChillTouchAction], 'Chill Touch');

    expect(rollPrompts).toHaveLength(1);
    expect(rollPrompts[0]).toMatchObject({
      kind: 'spell-attack',
      targetLabel: 'Corrupted Shard',
      weaponName: 'Chill Touch',
      attackBonus: 5,
      targetAc: 12,
      advantage: false,
      disadvantage: false,
    });
    const prompt = rollPrompts[0] as PlayerAttackRollSpec;
    expect(attackModifierForRoll(prompt)).toBe(5);
    expect(describeAttackRoll(prompt)).toBe('Chill Touch spell attack vs Corrupted Shard');
    expect(executeStructuredCombatActionWithBoundary.mock.calls[0].slice(0, 3)).toEqual([
      'enc-2343',
      expect.objectContaining({ action_type: 'cast_spell', spell_id: 'chill-touch' }),
      14,
    ]);
    expect(saveCards).toEqual([]);
    expect(result.text).toContain('spell attack 14 + 5 = 19 vs AC 12 — HIT');
    // One keyed End turn; the creature turn the server ran inside it hands the player back the turn.
    expect(
      executeAuthoritativeCombatIntent.mock.calls.filter(([, i]: any[]) => i?.type === 'end_turn'),
    ).toEqual([
      [expect.any(String), expect.objectContaining({ actionId: expect.any(String) }), 'dm'],
    ]);
    expect(result.text.trimEnd().endsWith('The Apprentice, what do you do?')).toBe(true);
  });

  it('asks the engine for the spell proposal with the exact intent the typed cast sends', async () => {
    await resolve([dmChillTouchAction], 'Chill Touch');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/v1\/combat\/enc-2343\/intent$/);
    expect(JSON.parse(init.body)).toEqual({
      intent: {
        type: 'spell',
        actorId: 'the-apprentice',
        targetIds: [SHARD_ID],
        spellId: 'chill-touch',
        spellName: 'Chill Touch',
      },
      source: 'dm',
      phase: 'propose',
    });
  });

  it('opens the same prompt when the DM writes the cantrip in the area shape and the route finds no area', async () => {
    resolveAoECast.mockResolvedValue(
      jsonResponse(422, {
        error: 'Chill Touch has no area of effect — name its target and cast it again',
        details: { reason: 'no_area_of_effect' },
      }),
    );

    await resolve([{ ...dmCantripAoEAction, spell_id: 'chill-touch' }], 'Chill Touch');

    expect(rollPrompts).toHaveLength(1);
    expect(rollPrompts[0]).toMatchObject({
      kind: 'spell-attack',
      actorLabel: 'The Apprentice',
      weaponName: 'Chill Touch',
      attackBonus: 5,
    });
    expect(executeStructuredCombatActionWithBoundary.mock.calls[0][2]).toBe(14);
  });

  it('opens no prompt, with no guessed +0, when the DM names no target', async () => {
    await resolve([{ ...dmChillTouchAction, target_ids: [] }], 'Chill Touch');

    expect(rollPrompts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the "Target saves" card and no die for a save spell', async () => {
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: {
        results: [
          {
            spellName: 'Acid Splash',
            actorName: 'The Apprentice',
            targetName: 'Corrupted Shard',
            saveAbility: 'dexterity',
            saveRoll: 12,
            saveDC: 13,
            saved: false,
            hit: true,
            damageType: 'acid',
            finalDamage: 2,
            targetNewHp: 5,
          },
        ],
      },
      boundary: null,
    });

    await resolve([{ ...dmChillTouchAction, spell_id: 'acid-splash' }], 'Acid Splash');

    expect(rollPrompts).toEqual([]);
    expect(saveCards).toEqual([
      expect.objectContaining({
        targetLabel: 'Corrupted Shard',
        spellName: 'Acid Splash',
        saveAbility: 'DEX',
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary.mock.calls[0][2]).toBeUndefined();
  });

  // #2426 item 2 (#2413 NIT): the sheet's Cast already showed the card before the DM was called
  // (#2392), so the declared cast consumes it instead of showing a second one. The hold is the
  // real producer: `holdSaveCardBeforeDm` shows the card and records it for `consumeHeldSaveCard`.
  it('shows one "Target saves" card, not two, and no die, when the sheet Cast already held it', async () => {
    await holdSaveCardBeforeDm({
      origin: 'sheet_cast',
      spellId: 'acid-splash',
      activeEncounter: {
        currentTurnParticipantId: APPRENTICE_ID,
        participants: [
          { ...APPRENTICE, currentHitPoints: 10 },
          { ...SHARD, currentHitPoints: 7 },
        ],
      },
    });
    expect(saveCards).toHaveLength(1);

    await resolve([{ ...dmChillTouchAction, spell_id: 'acid-splash' }], 'Acid Splash');

    expect(saveCards).toEqual([
      expect.objectContaining({
        targetLabel: 'Corrupted Shard',
        spellName: 'Acid Splash',
        saveAbility: 'DEX',
      }),
    ]);
    expect(rollPrompts).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary.mock.calls[0][2]).toBeUndefined();
  });
});
