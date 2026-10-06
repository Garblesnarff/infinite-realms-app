import { describe, expect, it } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../shared/test-fixtures/dying-participant-wire';
import { mapAuthoritativeCombat } from '../../../../contexts/combat/authoritative-combat-state';

describe('authoritative combat hydration', () => {
  it('restores exact turn, HP, conditions, and action economy after reconnect', () => {
    const encounter = mapAuthoritativeCombat({
      encounter: {
        id: 'enc',
        sessionId: 'session',
        status: 'active',
        currentRound: 3,
        currentTurnOrder: 1,
        startedAt: '2026-07-14T00:00:00.000Z',
      },
      participants: [
        {
          id: 'pc',
          characterId: 'character',
          name: 'Hero',
          participantType: 'player',
          initiative: 18,
          initiativeModifier: 3,
          armorClass: 17,
          maxHp: 24,
          speed: 30,
          actionUsed: true,
          status: { currentHp: 11, maxHp: 24, tempHp: 2, isConscious: true },
          conditions: [
            { condition: { name: 'Poisoned', description: 'Disadvantage on attacks.' } },
          ],
        },
        {
          id: 'goblin',
          name: 'Goblin',
          participantType: 'npc',
          initiative: 15,
          initiativeModifier: 2,
          armorClass: 15,
          maxHp: 7,
          speed: 30,
          status: { currentHp: 4, maxHp: 7, tempHp: 0, isConscious: true },
          conditions: [],
        },
      ],
    });
    expect(encounter).toMatchObject({ currentRound: 3, currentTurnParticipantId: 'goblin' });
    expect(encounter.participants[0]).toMatchObject({
      currentHitPoints: 11,
      temporaryHitPoints: 2,
      actionTaken: true,
    });
    expect(encounter.participants[0].conditions[0].name).toBe('poisoned');
  });

  it('preserves a zero-HP target as unavailable for pending-intent confirmation', () => {
    const encounter = mapAuthoritativeCombat({
      encounter: {
        id: 'enc',
        sessionId: 'session',
        status: 'active',
        currentRound: 3,
        currentTurnOrder: 0,
        startedAt: '2026-07-14T00:00:00.000Z',
      },
      participants: [
        {
          id: 'pc',
          characterId: 'character',
          name: 'Hero',
          participantType: 'player',
          initiative: 18,
          initiativeModifier: 3,
          armorClass: 17,
          maxHp: 24,
          speed: 30,
          status: { currentHp: 24, maxHp: 24, tempHp: 0, isConscious: true },
          conditions: [],
        },
        {
          id: 'vance',
          name: 'Vance',
          participantType: 'npc',
          initiative: 15,
          initiativeModifier: 2,
          armorClass: 12,
          maxHp: 7,
          speed: 30,
          status: { currentHp: 0, maxHp: 7, tempHp: 0, isConscious: false },
          conditions: [],
        },
      ],
    });

    expect(encounter.participants[1]).toMatchObject({
      currentHitPoints: 0,
      isUnconscious: true,
    });
  });
});

/**
 * #2518 (and Muse's sweep, candidate 3 of #2595): the death-save tallies the server counts used to
 * stop at the wire type, so a dying character's tracker rebuilt every participant at 0/0.
 * `DYING_SCHOLAR_PARTICIPANT` is a participant as `getCombatState` serves it (the server's
 * real-database suite pins the fixture to the producer).
 */
describe('authoritative combat hydration: the death-save state (#2518)', () => {
  const hydrate = (scholar: Record<string, unknown>) =>
    mapAuthoritativeCombat({
      encounter: { ...DYING_SCHOLAR_ENCOUNTER, currentTurnOrder: 0 },
      participants: [scholar],
    } as never).participants[0];

  it('the server recorded 2 failures: the client participant carries 0 saved and 2 failed', () => {
    const scholar = hydrate(DYING_SCHOLAR_PARTICIPANT);

    expect(scholar).toMatchObject({
      currentHitPoints: 0,
      maxHitPoints: 7,
      isUnconscious: true,
      isStable: false,
      isDead: false,
      deathSaves: { successes: 0, failures: 2 },
    });
    // The persisted `is_conscious = false` reads as the condition it is, for the tracker.
    expect(scholar.conditions.map((condition) => condition.name)).toContain('unconscious');
  });

  it('a stable player is unconscious, flagged stable, and not dead', () => {
    const scholar = hydrate({
      ...DYING_SCHOLAR_PARTICIPANT,
      vitalState: 'stabilized',
      status: {
        ...DYING_SCHOLAR_PARTICIPANT.status,
        deathSavesSuccesses: 3,
        deathSavesFailures: 0,
      },
    });

    expect(scholar).toMatchObject({
      isUnconscious: true,
      isStable: true,
      isDead: false,
      deathSaves: { successes: 3, failures: 0 },
    });
  });

  it('a dead player is flagged dead', () => {
    const scholar = hydrate({
      ...DYING_SCHOLAR_PARTICIPANT,
      vitalState: 'dead',
      status: { ...DYING_SCHOLAR_PARTICIPANT.status, deathSavesFailures: 3 },
    });

    expect(scholar).toMatchObject({ isDead: true, isStable: false, deathSaves: { failures: 3 } });
  });

  it('a standing player has no unconscious condition and no tallies', () => {
    const scholar = hydrate({
      ...DYING_SCHOLAR_PARTICIPANT,
      vitalState: 'standing',
      status: {
        ...DYING_SCHOLAR_PARTICIPANT.status,
        currentHp: 7,
        isConscious: true,
        deathSavesFailures: 0,
      },
    });

    expect(scholar.isUnconscious).toBe(false);
    expect(scholar.conditions.map((condition) => condition.name)).not.toContain('unconscious');
    expect(scholar.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});
