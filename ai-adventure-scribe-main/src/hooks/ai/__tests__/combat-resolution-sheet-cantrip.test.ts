/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cantripAoECastWireBody,
  dmCantripAoEAction,
} from '../../../../shared/test-fixtures/cantrip-aoe-cast';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';
import { holdSaveCardBeforeDm } from '@/services/combat/sheet-cast-save-hold';
import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';

/**
 * Run M9 R1 (#2374, #2375): the sheet's Cast for Acid Splash. The DM declares the cantrip in the
 * area shape with `slot_level: 0`; the route refused that body with "Validation failed" and the
 * player got no alert, no roll, and no reason. Everything from the resolution step down to the
 * save alert and the transcript is real; the network edge is stubbed with the answers the real
 * route gives (`server-bun/.../aoe-cast-player-spell-http.test.ts` posts the same fixture).
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const resolveAoECast = vi.fn();

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
const IMP_ID = '779792b2-aef0-4288-be43-19aba2530eba';
const APPRENTICE = { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' };
const SHARD = { id: SHARD_ID, name: 'Corrupted Shard', participantType: 'monster' };
const IMP = { id: IMP_ID, name: 'Kitchen Imp', participantType: 'monster' };

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** The route's answer for an area-shaped Acid Splash, and for the wire body it used to 422 on. */
const NO_AREA = jsonResponse(422, {
  error: 'Acid Splash has no area of effect — name its target and cast it again',
  details: { reason: 'no_area_of_effect' },
});
const VALIDATION_FAILED = jsonResponse(422, {
  error: 'Validation failed',
  issues: [{ path: '/slotLevel', message: 'Expected number to be greater or equal to 1' }],
});

const ACID_SPLASH_RESULT = {
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
};

const resolve = (participants: any[], combatActions: unknown[], overrides = {}) =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-m9',
    sessionId: 'session-m9',
    combatActions,
    declarationText: 'I cast Acid Splash [spell_id=acid-splash, spell_level=cantrip].',
    aiContext: {},
    conversationHistory: [],
    participants,
    playerInputOrigin: 'sheet_cast',
    ...overrides,
  });

const engineLines = (result: any): string[] =>
  (result.combatEngineBlocks ?? []).flatMap((block: any) => block.lines);

describe('the sheet-Cast Acid Splash in a fight (#2374, #2375)', () => {
  const presented: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    presented.length = 0;
    // The player continues the "Target saves" card the moment it appears.
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        presented.push(spec);
        settle();
        return () => {};
      },
    });
    chatWithDM.mockResolvedValue({ text: 'The acid hisses.', narrationSegments: [] });
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
  });

  it('sends the cantrip as slotLevel null, exactly the shared wire body', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: ACID_SPLASH_RESULT,
      boundary: null,
    });

    await resolve([APPRENTICE, SHARD], [dmCantripAoEAction]);

    expect(resolveAoECast).toHaveBeenCalledTimes(1);
    expect(resolveAoECast).toHaveBeenCalledWith('session-m9', cantripAoECastWireBody);
  });

  it('with one hostile, shows the save alert, resolves the save, and prints the engine line', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: ACID_SPLASH_RESULT,
      boundary: null,
    });

    const waits: boolean[] = [];
    const result = await resolve([APPRENTICE, SHARD], [dmCantripAoEAction], {
      onPlayerWaitChange: (waiting: boolean) => waits.push(waiting),
    });

    expect(presented).toEqual([
      {
        actorLabel: 'The Apprentice',
        targetLabel: 'Corrupted Shard',
        spellName: 'Acid Splash',
        saveAbility: 'DEX',
      },
    ]);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(waits).toEqual([true, false]);
    expect(executeStructuredCombatActionWithBoundary.mock.calls[0].slice(0, 2)).toEqual([
      'enc-m9',
      expect.objectContaining({
        actor_id: APPRENTICE_ID,
        action_type: 'cast_spell',
        spell_id: 'acid-splash',
        target_ids: [SHARD_ID],
        slot_level: null,
      }),
    ]);
    expect(engineLines(result)).toEqual([
      '⚙️ Engine: The Apprentice cast Acid Splash at Corrupted Shard — DEX save 12 vs DC 13 — FAIL. 2 acid damage. Corrupted Shard is now at 5 HP.',
    ]);
    expect(engineLines(result).join('\n')).not.toContain('refused');
    // One keyed End turn; the creature turn the server ran inside it hands the player back the turn.
    expect(
      executeAuthoritativeCombatIntent.mock.calls.filter(([, i]: any[]) => i?.type === 'end_turn'),
    ).toEqual([
      [expect.any(String), expect.objectContaining({ actionId: expect.any(String) }), 'dm'],
    ]);
    expect(result.text.trimEnd().endsWith('The Apprentice, what do you do?')).toBe(true);
  });

  it('asks once when the card was already shown before the DM call (#2392)', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: ACID_SPLASH_RESULT,
      boundary: null,
    });
    const participants = [APPRENTICE, SHARD];

    await holdSaveCardBeforeDm({
      origin: 'sheet_cast',
      spellId: 'acid-splash',
      activeEncounter: { currentTurnParticipantId: APPRENTICE_ID, participants },
    });
    expect(presented).toHaveLength(1);
    await resolve(participants, [dmCantripAoEAction]);

    expect(presented).toHaveLength(1);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
  });

  it('with two hostiles, refuses with "no target selected" and opens no alert', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);

    const result = await resolve([APPRENTICE, SHARD, IMP], [dmCantripAoEAction]);

    expect(presented).toEqual([]);
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(engineLines(result)).toEqual([
      '⚙️ Engine: The Apprentice\'s spell "Acid Splash" was refused (no target selected — name the creature you cast Acid Splash at). No roll, no damage, no wound.',
    ]);
  });

  it('ignores a hostile that is already down when it counts the targets', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: ACID_SPLASH_RESULT,
      boundary: null,
    });

    // The participant shape production has (`createCombatParticipant`): no `status`, no `isActive`.
    for (const down of [{ isUnconscious: true }, { isDead: true }, { currentHitPoints: 0 }]) {
      presented.length = 0;
      await resolve([APPRENTICE, SHARD, { ...IMP, ...down }], [dmCantripAoEAction]);

      expect(presented).toHaveLength(1);
      expect(presented[0].targetLabel).toBe('Corrupted Shard');
    }
  });

  it('with nobody left standing, refuses with "no target selected" and opens no alert', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);

    const result = await resolve(
      [APPRENTICE, { ...SHARD, isDead: true, currentHitPoints: 0 }],
      [dmCantripAoEAction],
    );

    expect(presented).toEqual([]);
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(engineLines(result).join('\n')).toContain('no target selected');
  });

  it('withholds a cast the DM made on a turn no player message started, without guessing a target', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);

    await resolve([APPRENTICE, SHARD], [dmCantripAoEAction], { playerInputOrigin: null });

    expect(resolveAoECast).not.toHaveBeenCalled();
    expect(presented).toEqual([]);
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
  });

  describe('a typed cast in the area shape (#2443)', () => {
    // Run M10: "I cast Acid Splash at the Bitter End Mercenary", declared by the DM as
    // `dmCantripAoEAction` and refused by the route as `no_area_of_effect`.
    const typed = (playerMessage: string, participants = [APPRENTICE, SHARD, IMP]) =>
      resolve(participants, [dmCantripAoEAction], { playerInputOrigin: 'typed', playerMessage });

    beforeEach(() => {
      resolveAoECast.mockResolvedValue(NO_AREA);
      executeStructuredCombatActionWithBoundary.mockResolvedValue({
        outcomes: [],
        result: ACID_SPLASH_RESULT,
        boundary: null,
      });
    });

    it('casts it at the one creature the player named, among several', async () => {
      const result = await typed('I cast Acid Splash at the Corrupted Shard');

      expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
      expect(executeStructuredCombatActionWithBoundary.mock.calls[0].slice(0, 2)).toEqual([
        'enc-m9',
        expect.objectContaining({
          actor_id: APPRENTICE_ID,
          action_type: 'cast_spell',
          spell_id: 'acid-splash',
          target_ids: [SHARD_ID],
          slot_level: null,
        }),
      ]);
      expect(engineLines(result).join('\n')).not.toContain('refused');
      // The route refused once; nothing asks the DM to declare it again.
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    });

    it('does not guess when the words name nobody on the board', async () => {
      const result = await typed('I cast Acid Splash at the Sour Knight');

      expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
      expect(engineLines(result).join('\n')).toContain(
        'Acid Splash has no area of effect — name its target and cast it again',
      );
    });

    it('does not guess when the words name two creatures', async () => {
      await typed('I cast Acid Splash at the Corrupted Shard and the Kitchen Imp');

      expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    });

    it('does not pick a downed creature the player named', async () => {
      await typed('I cast Acid Splash at the Corrupted Shard', [
        APPRENTICE,
        { ...SHARD, isDead: true, currentHitPoints: 0 },
        IMP,
      ]);

      expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    });
  });

  it('spends no repair call on a refused typed player cast (#2443)', async () => {
    resolveAoECast.mockResolvedValue(NO_AREA);

    await resolve([APPRENTICE, SHARD, IMP], [dmCantripAoEAction], {
      playerInputOrigin: 'typed',
      playerMessage: 'I cast Acid Splash at the Sour Knight',
    });

    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
  });

  it.each([
    ['a typed cast, which names its own target', { playerInputOrigin: 'typed' }, {}],
    ['an area spell the player list does not know', {}, { spell_id: 'fireball' }],
    ['a monster casting it', {}, { actor_id: SHARD_ID }],
  ])('keeps the engine refusal for %s', async (_label, overrides, actionOverrides) => {
    resolveAoECast.mockResolvedValue(NO_AREA);

    const result = await resolve(
      [APPRENTICE, SHARD],
      [{ ...dmCantripAoEAction, ...actionOverrides }],
      overrides,
    );

    expect(presented).toEqual([]);
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    const line = engineLines(result).find((entry) => entry.includes('was refused')) ?? '';
    expect(line).toContain('has no area of effect — name its target and cast it again');
    expect(line).not.toContain('no target selected');
  });
});

describe('every refusal of a player spell says what to do (#2374)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({ text: 'Nothing happens.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
  });

  const targeted = {
    actor_id: APPRENTICE_ID,
    action_type: 'cast_spell',
    target_ids: [SHARD_ID],
    weapon_id: null,
    spell_id: 'chill-touch',
    slot_level: null,
    movement_feet: 0,
  };

  const refusedLine = async (refusal: CombatIntentRefusedError): Promise<string> => {
    executeStructuredCombatActionWithBoundary.mockRejectedValue(refusal);
    const result = await resolve([APPRENTICE, SHARD], [targeted]);
    return engineLines(result).find((line) => line.includes('was refused')) ?? '';
  };

  it('not your turn: names the turn holder, not "current-turn participant"', async () => {
    const line = await refusedLine(
      new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
        currentParticipantId: SHARD_ID,
      }),
    );
    expect(line).toContain('(it is not your turn — Corrupted Shard acts now)');
    expect(line).not.toContain('current-turn participant');
  });

  it('names the turn holder from a slug the roster knows', async () => {
    const line = await refusedLine(
      new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
        currentParticipantSlug: 'corrupted-shard',
      }),
    );
    expect(line).toContain('(it is not your turn — Corrupted Shard acts now)');
  });

  it('a bare "Validation failed" from the combat route says the cast could not be read', async () => {
    const line = await refusedLine(new CombatIntentRefusedError('Validation failed', 422));
    expect(line).toContain(
      '(the game could not read that cast — cast it again and name your target)',
    );
    expect(line).not.toContain('Validation failed');
  });

  it('an aoe-cast 422 with no issues listed says the same', async () => {
    resolveAoECast.mockResolvedValue(jsonResponse(422, { error: 'Validation failed' }));
    const result = await resolve([APPRENTICE, SHARD], [dmCantripAoEAction]);
    const line = engineLines(result).find((entry) => entry.includes('was refused')) ?? '';
    expect(line).toContain(
      '(the game could not read that cast — cast it again and name your target)',
    );
  });

  it('no target selected: the intent schema rejected an empty target list', async () => {
    const line = await refusedLine(
      new CombatIntentRefusedError('Invalid combat intent', 422, {
        stage: 'intent_schema',
        missing: ['targetIds'],
      }),
    );
    expect(line).toContain('(no target selected — name the creature you cast it at)');
  });

  it('a body the schema could not read: says to cast it again, not "Validation failed"', async () => {
    resolveAoECast.mockResolvedValue(VALIDATION_FAILED);
    const result = await resolve(
      [APPRENTICE, SHARD],
      [{ ...dmCantripAoEAction, origin: { x: 1, y: 1 } }],
    );
    const line = engineLines(result).find((entry) => entry.includes('was refused')) ?? '';
    expect(line).toContain(
      '(the game could not read that cast — cast it again and name your target)',
    );
    expect(line).not.toContain('Validation failed');
  });

  it('not prepared: keeps the engine sentence that says to cast a spell you know or have prepared', async () => {
    const line = await refusedLine(
      new CombatIntentRefusedError(
        "Spell refused: Chill Touch is not on The Apprentice's sheet — cast a spell you know or have prepared",
        422,
        { reason: 'spell_not_known' },
      ),
    );
    expect(line).toContain('cast a spell you know or have prepared');
  });
});
