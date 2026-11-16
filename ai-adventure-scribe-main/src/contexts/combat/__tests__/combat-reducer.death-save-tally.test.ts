import { describe, expect, it } from 'vitest';

import { combatReducer, initialCombatState } from '../combat-reducer';

import type { CombatEncounter, CombatState } from '@/types/combat';

/** #906: the printed death-save tally lives on combat state until a fresh server read replaces it. */
describe('combat reducer: death-save tally (#906)', () => {
  const encounter = {
    id: 'enc-1',
    phase: 'active',
    participants: [],
  } as unknown as CombatEncounter;

  it('RECORD_DEATH_SAVE_TALLY stores the tally for that participant only', () => {
    const state = combatReducer(initialCombatState as CombatState, {
      type: 'RECORD_DEATH_SAVE_TALLY',
      participantId: 'scholar',
      tally: { successes: 2, failures: 1 },
    });
    expect(state.deathSaveTallies).toEqual({ scholar: { successes: 2, failures: 1 } });
  });

  it('a later record for another participant keeps the first one', () => {
    let state = combatReducer(initialCombatState as CombatState, {
      type: 'RECORD_DEATH_SAVE_TALLY',
      participantId: 'scholar',
      tally: { successes: 2, failures: 0 },
    });
    state = combatReducer(state, {
      type: 'RECORD_DEATH_SAVE_TALLY',
      participantId: 'ally',
      tally: { successes: 0, failures: 3 },
    });
    expect(state.deathSaveTallies).toEqual({
      scholar: { successes: 2, failures: 0 },
      ally: { successes: 0, failures: 3 },
    });
  });

  it('SET_ENCOUNTER clears the recorded tally, so a fresh server read wins', () => {
    const recorded = combatReducer(initialCombatState as CombatState, {
      type: 'RECORD_DEATH_SAVE_TALLY',
      participantId: 'scholar',
      tally: { successes: 3, failures: 0 },
    });
    const refreshed = combatReducer(recorded, { type: 'SET_ENCOUNTER', encounter });
    expect(refreshed.deathSaveTallies).toBeUndefined();
    expect(refreshed.activeEncounter).toBe(encounter);
  });
});
