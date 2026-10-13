import { beforeEach, describe, expect, it } from 'vitest';

import {
  CombatEntryConfirmationUnavailableError,
  consumeCombatEntryTypedAnswer,
  markCombatEntryTypedAnswer,
  onCombatEntryConfirmationPendingChange,
  requestCombatEntryAnswer,
  requestCombatEntryConfirmation,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
} from '../combat-entry-confirmation-bridge';

describe('combat-entry-confirmation-bridge', () => {
  beforeEach(() => {
    setCombatEntryConfirmationHost(null);
  });

  it('rejects distinctly when no confirmation host is mounted', async () => {
    await expect(
      requestCombatEntryConfirmation({
        actorLabel: 'The Seeker',
        combatantLabels: ['Darkwater'],
        initiativeRoll: null,
        initiativeModifier: 1,
      }),
    ).rejects.toBeInstanceOf(CombatEntryConfirmationUnavailableError);
  });

  it('reports which creature the player picked, and still answers a plain strike with a boolean (#2341)', async () => {
    setCombatEntryConfirmationHost({ present: () => () => {} });
    const spec = {
      actorLabel: 'The Scholar',
      combatantLabels: ['Valerius', 'Professor Darkwater'],
      targetChoices: ['Valerius', 'Professor Darkwater'],
      initiativeRoll: null,
      initiativeModifier: 1,
    };

    const picked = requestCombatEntryAnswer(spec);
    settlePendingCombatEntryConfirmation(true, 'Valerius');
    await expect(picked).resolves.toEqual({ confirmed: true, target: 'Valerius' });

    const declined = requestCombatEntryAnswer(spec);
    settlePendingCombatEntryConfirmation(false);
    await expect(declined).resolves.toEqual({ confirmed: false });

    const strike = requestCombatEntryConfirmation({ ...spec, targetChoices: undefined });
    settlePendingCombatEntryConfirmation(true);
    await expect(strike).resolves.toBe(true);
  });

  it('notifies pending-change listeners on present and on settle (#400)', async () => {
    setCombatEntryConfirmationHost({ present: () => () => {} });
    const seen: boolean[] = [];
    const unsubscribe = onCombatEntryConfirmationPendingChange((isPending) => {
      seen.push(isPending);
    });
    const spec = {
      actorLabel: 'The Scholar',
      combatantLabels: ['Valerius'],
      initiativeRoll: null,
      initiativeModifier: 1,
    };

    const pending = requestCombatEntryAnswer(spec);
    expect(seen).toEqual([true]);
    settlePendingCombatEntryConfirmation(false);
    expect(seen).toEqual([true, false]);
    await expect(pending).resolves.toEqual({ confirmed: false });

    unsubscribe();
    const pending2 = requestCombatEntryAnswer(spec);
    settlePendingCombatEntryConfirmation(true);
    await expect(pending2).resolves.toEqual({ confirmed: true });
    expect(seen).toEqual([true, false]);
  });

  it('arms a one-shot typed answer tied to the message text (#400)', () => {
    expect(consumeCombatEntryTypedAnswer('fire bolt')).toBe(false);
    markCombatEntryTypedAnswer('fire bolt');
    // A different message does not consume the skip, and clears the stale mark.
    expect(consumeCombatEntryTypedAnswer('I look around')).toBe(false);
    markCombatEntryTypedAnswer('fire bolt');
    expect(consumeCombatEntryTypedAnswer('fire bolt')).toBe(true);
    expect(consumeCombatEntryTypedAnswer('fire bolt')).toBe(false);
  });
});
