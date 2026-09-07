import { beforeEach, describe, expect, it } from 'vitest';

import {
  CombatEntryConfirmationUnavailableError,
  requestCombatEntryConfirmation,
  setCombatEntryConfirmationHost,
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
});
