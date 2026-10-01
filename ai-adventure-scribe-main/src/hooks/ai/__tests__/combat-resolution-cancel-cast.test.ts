/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dmCantripAoEAction } from '../../../../shared/test-fixtures/cantrip-aoe-cast';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

import {
  beginSheetCast,
  cancelSheetCast,
  finishSheetCast,
  getSheetCastSnapshot,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';
import { clearHeldSaveCard } from '@/services/combat/sheet-cast-save-hold';
import {
  setSpellTargetSaveHost,
  settlePendingSpellTargetSave,
} from '@/services/combat/spell-target-save-bridge';

/**
 * #2418: Cancel cast gives the slot back by never taking it. The engine spends the slot when
 * `executeStructuredCombatActionWithBoundary` hands it the cast (`resolveSpell`, which calls
 * `SpellSlotsService.useSpellSlot`); the save card and the engine's proposal spend nothing. So a
 * cancel before that call must leave it uncalled, and a cancel after it must be refused.
 *
 * Everything from the resolution step down to the progress store and the save bridge is real. The
 * edge is stubbed with the answers the real route gives, as in the sibling sheet-cast tests: the
 * Acid Splash result is `resolveSpell`'s output for a save spell that the target fails.
 */
const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const advanceNpcTurns = vi.fn();
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
    advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args),
    resolveAoECast: (...args: any[]) => resolveAoECast(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const SHARD_ID = '5d1e0a44-1111-4222-8333-444444444444';
const APPRENTICE = { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' };
const SHARD = { id: SHARD_ID, name: 'Corrupted Shard', participantType: 'monster' };

const dmAcidSplash = {
  actor_id: 'the-apprentice',
  action_type: 'cast_spell' as const,
  target_ids: [SHARD_ID],
  weapon_id: null,
  spell_id: 'acid-splash',
  slot_level: null,
  movement_feet: 0,
};

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

const resolve = (origin: 'sheet_cast' | 'typed' = 'sheet_cast') =>
  resolveWith(dmAcidSplash, origin);

const resolveWith = (action: unknown, origin: 'sheet_cast' | 'typed' = 'sheet_cast') =>
  resolveDeclaredCombatActions({
    encounterId: 'enc-2418',
    sessionId: 'session-2418',
    combatActions: [action],
    declarationText: 'I cast Acid Splash [spell_id=acid-splash, spell_level=cantrip].',
    aiContext: {},
    conversationHistory: [],
    participants: [APPRENTICE, SHARD],
    playerInputOrigin: origin,
    declaredPlayerSpell: { spellId: 'acid-splash', spellName: 'Acid Splash' },
  } as any);

describe('Cancel cast (#2418)', () => {
  const saveCards: unknown[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    clearHeldSaveCard();
    resetSheetCastProgress();
    saveCards.length = 0;
    setSpellTargetSaveHost({
      present: (spec) => {
        saveCards.push(spec);
        return () => {};
      },
    });
    chatWithDM.mockResolvedValue({ text: 'The acid hisses.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: SHARD_ID, name: 'Corrupted Shard' },
    });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [],
      result: ACID_SPLASH_RESULT,
      boundary: null,
    });
    advanceNpcTurns.mockResolvedValue({
      results: [],
      currentParticipant: { id: APPRENTICE_ID, name: 'The Apprentice' },
      combatEnded: false,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    });
  });

  it('Cancel cast on the save card sends nothing to the engine and says no slot was used', async () => {
    beginSheetCast('Acid Splash');
    const turn = resolve();
    await vi.waitFor(() => expect(saveCards).toHaveLength(1));
    expect(getSheetCastSnapshot().cast?.phase).toBe('save');

    expect(cancelSheetCast()).toBe(true);
    const result = await turn;

    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(advanceNpcTurns).not.toHaveBeenCalled();
    expect(result.text).toContain('You cancelled the cast');
    expect(result.text).toContain('no spell slot was used');
    expect(result.text).toContain('It is still your turn');
    expect(result.combatEngineBlocks ?? []).toEqual([]);
    expect(getSheetCastSnapshot().cast).toBeNull();
  });

  it('Cancel cast pressed while the DM was still reading stops the cast before the engine', async () => {
    beginSheetCast('Acid Splash');
    // The DM's reply arrives after the player pressed Cancel cast.
    expect(cancelSheetCast()).toBe(true);

    const result = await resolve();

    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(saveCards).toEqual([]);
    expect(result.text).toContain('no spell slot was used');
  });

  it('hands the cast to the engine once, refuses a late Cancel, and shows the result in the dock', async () => {
    beginSheetCast('Acid Splash');
    const turn = resolve();
    await vi.waitFor(() => expect(saveCards).toHaveLength(1));
    // The player continues on the card.
    settlePendingSpellTargetSave();
    // Not cancellable once the engine holds the cast.
    await turn;

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(cancelSheetCast()).toBe(false);
    const { cast } = getSheetCastSnapshot();
    expect(cast?.phase).toBe('resolving');
    expect(cast?.cancellable).toBe(false);
    expect(cast?.results?.[0]?.kind).toBe('spell');
    expect(cast?.results?.[0]?.badge?.word).toBe('TARGET FAILED');

    finishSheetCast();
    expect(getSheetCastSnapshot().cast?.phase).toBe('done');
  });

  it('Cancel pressed while the area call runs is refused: the slot is spent, the result shows, never both', async () => {
    let answerArea!: (value: unknown) => void;
    resolveAoECast.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerArea = resolve;
        }),
    );
    beginSheetCast('Burning Hands');
    const turn = resolveWith({ ...dmCantripAoEAction, spell_id: 'burning-hands' });
    await vi.waitFor(() => expect(resolveAoECast).toHaveBeenCalledTimes(1));
    // The engine holds the cast (it spends the slot inside this call), so Cancel is refused.
    expect(getSheetCastSnapshot().cast).toMatchObject({ phase: 'resolving', cancellable: false });
    expect(cancelSheetCast()).toBe(false);
    expect(getSheetCastSnapshot().cast?.phase).toBe('resolving');

    // The route answers that the area is placed and waits for the player: nothing resolved here.
    answerArea({
      ok: false,
      status: 409,
      json: async () => ({ error: 'placed', details: { reason: 'aoe_awaiting_confirmation' } }),
    });
    await turn;
  });

  it('the area call is not made at all when Cancel was pressed first', async () => {
    beginSheetCast('Burning Hands');
    cancelSheetCast();

    const result = await resolveWith({ ...dmCantripAoEAction, spell_id: 'burning-hands' });

    expect(resolveAoECast).not.toHaveBeenCalled();
    expect(result.text).toContain('no spell slot was used');
  });

  it('a refused area (single-target spell in the area shape) reopens the cast, so Cancel works on the card', async () => {
    // What the aoe-cast route answers for a spell with no area (the sheet-cast sibling test's stub).
    resolveAoECast.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Acid Splash has no area of effect — name its target and cast it again',
        details: { reason: 'no_area_of_effect' },
      }),
    });
    beginSheetCast('Acid Splash');
    const turn = resolveWith({ ...dmCantripAoEAction, spell_id: 'acid-splash' });
    await vi.waitFor(() => expect(saveCards).toHaveLength(1));
    // Nothing was spent by the refused area call, so the cast is cancellable again.
    expect(getSheetCastSnapshot().cast).toMatchObject({ phase: 'save', cancellable: true });

    expect(cancelSheetCast()).toBe(true);
    const result = await turn;

    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(result.text).toContain('no spell slot was used');
  });

  it('cancelling a typed cast’s save card withdraws it the same way, with no sheet cast behind it', async () => {
    const turn = resolve('typed');
    await vi.waitFor(() => expect(saveCards).toHaveLength(1));

    expect(cancelSheetCast()).toBe(true);
    const result = await turn;

    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(result.text).toContain('You cancelled the cast');
  });
});
