import { beforeEach, describe, expect, it } from 'vitest';

import {
  CombatEntryConfirmationUnavailableError,
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
});
