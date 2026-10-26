import { describe, expect, it } from 'vitest';

import {
  actedCount,
  nearestEnemyDistanceFeet,
  summarizeCombatTurn,
  turnBarSub,
  turnBarTitle,
} from '../combat-turn-order';

import type { CombatParticipant } from '@/types/combat-participants';

const baseParticipant = (overrides: Partial<CombatParticipant>): CombatParticipant =>
  ({
    id: 'p',
    name: 'Creature',
    participantType: 'enemy',
    maxHitPoints: 10,
    currentHitPoints: 10,
    temporaryHitPoints: 0,
    armorClass: 12,
    initiative: 10,
    speed: 30,
    actionTaken: false,
    bonusActionTaken: false,
    reactionTaken: false,
    movementUsed: 0,
    movementRemaining: 30,
    reactionOpportunities: [],
    conditions: [],
    deathSaves: { successes: 0, failures: 0 },
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    ...overrides,
  }) as CombatParticipant;

describe('summarizeCombatTurn', () => {
  it('marks a dead enemy as down, not acted (#223 CB-007)', () => {
    const summary = summarizeCombatTurn({
      currentRound: 4,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'stalker2',
          name: 'Stalker 2',
          initiative: 5,
          currentHitPoints: 0,
          isDead: true,
        }),
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
      ],
    });
    expect(summary).not.toBeNull();
    const stalker = summary!.actors.find((a) => a.id === 'stalker2');
    expect(stalker?.state).toBe('down');
  });

  it('marks a monster at 0 HP as down even without the isDead flag (#223 CB-007)', () => {
    const summary = summarizeCombatTurn({
      currentRound: 4,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({ id: 'stalker2', name: 'Stalker 2', initiative: 5, currentHitPoints: 0 }),
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
      ],
    });
    const stalker = summary!.actors.find((a) => a.id === 'stalker2');
    expect(stalker?.state).toBe('down');
  });

  it('keeps a living enemy that acted earlier as acted', () => {
    const summary = summarizeCombatTurn({
      currentRound: 2,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({ id: 'stalker1', name: 'Stalker 1', initiative: 18 }),
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
      ],
    });
    const stalker = summary!.actors.find((a) => a.id === 'stalker1');
    expect(stalker?.state).toBe('acted');
  });

  it('counts acted actors, not down ones, for "N of M have acted" (#223 CB-007)', () => {
    const summary = summarizeCombatTurn({
      currentRound: 4,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({ id: 'stalker1', name: 'Stalker 1', initiative: 20 }),
        baseParticipant({
          id: 'stalker2',
          name: 'Stalker 2',
          initiative: 5,
          currentHitPoints: 0,
          isDead: true,
        }),
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
      ],
    });
    expect(summary).not.toBeNull();
    // Stalker 1 (initiative 20) acted before the hero; Stalker 2 is dead and must not count.
    expect(actedCount(summary!)).toBe(1);
  });
});

describe('turn bar copy (#85)', () => {
  it('skips a leading article when taking token initials', () => {
    const summary = summarizeCombatTurn({
      currentRound: 1,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Scholar',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(summary!.actors.find((a) => a.id === 'hero')?.initials).toBe('S');
    expect(summary!.actors.find((a) => a.id === 'm1')?.initials).toBe('GP');
  });

  it('numbers a token whose initials are still equal', () => {
    const summary = summarizeCombatTurn({
      currentRound: 1,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Hunter',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'The Hound', initiative: 4 }),
      ],
    });
    expect(summary!.actors.map((a) => a.initials)).toEqual(['H', 'H2']);
  });

  it('reads the action-used sub from the player participant', () => {
    const summary = summarizeCombatTurn({
      currentRound: 2,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
          actionTaken: true,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(summary!, null)).toBe('Your turn');
    expect(turnBarSub(summary!, null)).toBe('Round 2 · action used · bonus action and move left');
  });

  it('names the enemy turn and the wait', () => {
    const summary = summarizeCombatTurn({
      currentRound: 2,
      currentTurnParticipantId: 'm1',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(summary!, null)).toBe("Glass Prowler's turn");
    expect(turnBarSub(summary!, null)).toBe('Round 2 · wait for it to act');
  });

  it('reads You are down from the dying player, and from 0 HP without the flag', () => {
    const dying = summarizeCombatTurn({
      currentRound: 3,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
          currentHitPoints: 0,
          isUnconscious: true,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(dying!, null)).toBe('You are down');
    expect(turnBarSub(dying!, null)).toBe('0 HP · roll a death saving throw');

    const flat = summarizeCombatTurn({
      currentRound: 3,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
          currentHitPoints: 0,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(flat!, null, true)).toBe('You are down');
    expect(turnBarSub(flat!, null, true)).toBe('0 HP · roll a death saving throw');
  });

  it('keeps the in-flight overrides: Casting… and an enemy acting', () => {
    const summary = summarizeCombatTurn({
      currentRound: 2,
      currentTurnParticipantId: 'hero',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(summary!, 'casting')).toBe('Casting…');
    const enemy = summarizeCombatTurn({
      currentRound: 2,
      currentTurnParticipantId: 'm1',
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    });
    expect(turnBarTitle(enemy!, 'acting')).toBe('Glass Prowler is acting…');
  });
});

describe('nearestEnemyDistanceFeet (#85)', () => {
  const placed = (x: number, y: number) => ({ x, y, sceneId: 'scene-1' });

  it('measures the nearest enemy in 5 ft squares', () => {
    const encounter = {
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
          position: placed(0, 0),
        }),
        baseParticipant({ id: 'far', name: 'Far Stalker', initiative: 4, position: placed(3, 0) }),
        baseParticipant({
          id: 'near',
          name: 'Near Stalker',
          initiative: 3,
          position: placed(1, 1),
        }),
      ],
    };
    expect(nearestEnemyDistanceFeet(encounter)).toEqual({ name: 'Near Stalker', feet: 5 });
  });

  it('reports nothing when either side has no position', () => {
    const noEnemyPosition = {
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
          position: placed(0, 0),
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4 }),
      ],
    };
    expect(nearestEnemyDistanceFeet(noEnemyPosition)).toBeNull();
    const noPlayerPosition = {
      participants: [
        baseParticipant({
          id: 'hero',
          name: 'The Veteran',
          participantType: 'player',
          initiative: 15,
        }),
        baseParticipant({ id: 'm1', name: 'Glass Prowler', initiative: 4, position: placed(1, 0) }),
      ],
    };
    expect(nearestEnemyDistanceFeet(noPlayerPosition)).toBeNull();
    expect(nearestEnemyDistanceFeet(null)).toBeNull();
  });
});
