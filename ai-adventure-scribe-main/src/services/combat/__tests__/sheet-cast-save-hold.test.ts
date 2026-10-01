import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearHeldSaveCard,
  consumeHeldSaveCard,
  holdSaveCardBeforeDm,
} from '../sheet-cast-save-hold';

import type { SpellTargetSaveSpec } from '@/services/combat/spell-target-save-bridge';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { proposeAuthoritativeSpell } from '@/services/combat/combat-attack-proposal';
import {
  resetSheetCastProgress,
  beginSheetCast,
  getSheetCastSnapshot,
} from '@/services/combat/sheet-cast-progress';
import {
  cancelPendingSpellTargetSave,
  setSpellTargetSaveHost,
} from '@/services/combat/spell-target-save-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn(),
}));

/**
 * What `/v1/combat/:id/intent` answers to `phase: 'propose'` for a save spell: the shape of
 * `CombatAttackService.proposeSpellAttack` (`saveDC` is 8 + the caster's spell attack bonus, here
 * +6 for the Scholar) plus the route's `movementOnly: false`.
 */
const SAVE_SPELL_PROPOSAL = {
  movementOnly: false as const,
  spellId: 'acid-splash',
  spellName: 'Acid Splash',
  kind: 'save' as const,
  attackBonus: 6,
  saveDC: 14,
  targetAc: 12,
  advantage: false,
  disadvantage: false,
};

/**
 * #2392. Encounters come from `mapAuthoritativeCombat`, the producer the client uses for every
 * server encounter, so participants carry the fields production sets (`participantType: 'monster'`
 * for every non-player, `isUnconscious`, `currentHitPoints`).
 */
const PLAYER_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const SARAH_ID = '5d1e0a44-1111-4222-8333-444444444444';

const server = (
  name: string,
  id: string,
  participantType: string,
  status = { currentHp: 9, maxHp: 9, tempHp: 0, isConscious: true },
) => ({
  id,
  name,
  participantType,
  initiative: 10,
  initiativeModifier: 1,
  armorClass: 12,
  maxHp: 9,
  speed: 30,
  status,
});

const encounter = (participants: ReturnType<typeof server>[], currentTurnOrder = 0) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-2392',
      sessionId: 'session-2392',
      status: 'active',
      currentRound: 1,
      currentTurnOrder,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants,
  });

const player = server('The Apprentice', PLAYER_ID, 'player');
const sarah = server('Captain Sarah Reeves', SARAH_ID, 'npc');

describe('holdSaveCardBeforeDm (#2392)', () => {
  const presented: SpellTargetSaveSpec[] = [];

  beforeEach(() => {
    presented.length = 0;
    clearHeldSaveCard();
    resetSheetCastProgress();
    vi.mocked(proposeAuthoritativeSpell).mockReset();
    vi.mocked(proposeAuthoritativeSpell).mockResolvedValue(SAVE_SPELL_PROPOSAL);
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        presented.push(spec);
        settle();
        return () => {};
      },
    });
  });

  const hold = (
    active: ReturnType<typeof encounter>,
    overrides: Partial<Parameters<typeof holdSaveCardBeforeDm>[0]> = {},
  ) =>
    holdSaveCardBeforeDm({
      origin: 'sheet_cast',
      spellId: 'acid-splash',
      activeEncounter: active,
      ...overrides,
    });

  it('shows the card for the one standing creature, by the label the declared cast uses', async () => {
    await hold(encounter([player, sarah]));

    expect(presented).toEqual([
      {
        actorLabel: 'The Apprentice',
        targetLabel: 'Captain Sarah Reeves',
        spellName: 'Acid Splash',
        saveAbility: 'DEX',
        saveDc: 14,
      },
    ]);
    // The DC comes from the engine's read-only proposal, for the caster and the one target.
    expect(proposeAuthoritativeSpell).toHaveBeenCalledWith('enc-2392', {
      type: 'spell',
      actorId: PLAYER_ID,
      targetIds: [SARAH_ID],
      spellId: 'acid-splash',
      spellName: 'Acid Splash',
    });
  });

  it('shows the card with no DC when the engine refuses or fails the proposal', async () => {
    vi.mocked(proposeAuthoritativeSpell).mockRejectedValue(
      new Error('Combat action rejected (404)'),
    );

    await hold(encounter([player, sarah]));

    expect(presented).toEqual([
      {
        actorLabel: 'The Apprentice',
        targetLabel: 'Captain Sarah Reeves',
        spellName: 'Acid Splash',
        saveAbility: 'DEX',
      },
    ]);
  });

  it('does not let a slow DC proposal hold the card: it shows without the DC after 2 s', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(proposeAuthoritativeSpell).mockReturnValue(new Promise(() => {}));

      const held = hold(encounter([player, sarah]));
      await vi.advanceTimersByTimeAsync(2000);
      await held;

      expect(presented).toEqual([
        {
          actorLabel: 'The Apprentice',
          targetLabel: 'Captain Sarah Reeves',
          spellName: 'Acid Splash',
          saveAbility: 'DEX',
        },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the turn before the DM when the player cancels the card, and holds nothing', async () => {
    setSpellTargetSaveHost({
      present: (spec) => {
        presented.push(spec);
        queueMicrotask(() => cancelPendingSpellTargetSave());
        return () => {};
      },
    });
    await expect(hold(encounter([player, sarah]))).resolves.toBe('cancelled');

    expect(consumeHeldSaveCard('Acid Splash', 'Captain Sarah Reeves')).toBe(false);
  });

  it('moves a sheet cast to the save phase while the card waits, and back to the DM on Continue', async () => {
    beginSheetCast('Acid Splash');
    let continueCard: () => void = () => {};
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        presented.push(spec);
        continueCard = settle;
        return () => {};
      },
    });

    const held = hold(encounter([player, sarah]));
    await vi.waitFor(() => expect(presented).toHaveLength(1));
    expect(getSheetCastSnapshot().cast).toMatchObject({
      phase: 'save',
      targetName: 'Captain Sarah Reeves',
    });

    continueCard();
    await held;
    expect(getSheetCastSnapshot().cast).toMatchObject({ phase: 'dm', savePassed: true });
  });

  it('does not settle until the player continues, so the caller can hold the DM call', async () => {
    let continueCard: () => void = () => {};
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        presented.push(spec);
        continueCard = settle;
        return () => {};
      },
    });
    let done = false;
    const held = hold(encounter([player, sarah])).then(() => {
      done = true;
    });

    // The engine's DC proposal is awaited first, so the card comes a tick or two later.
    await vi.waitFor(() => expect(presented).toHaveLength(1));
    expect(done).toBe(false);
    continueCard();
    await held;
    expect(done).toBe(true);
  });

  it.each([
    ['a typed cast', { origin: 'typed' as const }, [player, sarah]],
    ['an attack-roll spell', { spellId: 'chill-touch' }, [player, sarah]],
    ['a cone spell (Burning Hands)', { spellId: 'burning-hands' }, [player, sarah]],
    ['an unknown spell', { spellId: 'meteor-swarm' }, [player, sarah]],
    ['two standing creatures', {}, [player, sarah, server('Kitchen Imp', 'imp-id', 'npc')]],
  ])('holds nothing for %s', async (_label, overrides, participants) => {
    await hold(encounter(participants), overrides);

    expect(presented).toEqual([]);
  });

  it('does not count a creature that is down', async () => {
    const downed = server('Kitchen Imp', 'imp-id', 'npc', {
      currentHp: 0,
      maxHp: 9,
      tempHp: 0,
      isConscious: false,
    });

    await hold(encounter([player, sarah, downed]));

    expect(presented.map((spec) => spec.targetLabel)).toEqual(['Captain Sarah Reeves']);
  });

  it('holds nothing when it is not the player’s turn or no fight is open', async () => {
    await hold(encounter([player, sarah], 1));
    await hold(null as never);

    expect(presented).toEqual([]);
  });

  it('lets the DM-declared cast skip the card once, and only for the same spell and creature', async () => {
    await hold(encounter([player, sarah]));

    expect(consumeHeldSaveCard('Acid Splash', 'Kitchen Imp')).toBe(false);
    // A mismatch spends it: the next declared cast shows its own card.
    expect(consumeHeldSaveCard('Acid Splash', 'Captain Sarah Reeves')).toBe(false);

    await hold(encounter([player, sarah]));
    expect(consumeHeldSaveCard('Acid Splash', 'Captain Sarah Reeves')).toBe(true);
    expect(consumeHeldSaveCard('Acid Splash', 'Captain Sarah Reeves')).toBe(false);
  });

  it('forgets a held card when the next turn starts', async () => {
    await hold(encounter([player, sarah]));
    await hold(encounter([player, sarah]), { origin: 'typed' });

    expect(consumeHeldSaveCard('Acid Splash', 'Captain Sarah Reeves')).toBe(false);
  });
});
