import { describe, expect, it } from 'vitest';

import { actedCount, summarizeCombatTurn } from '../combat-turn-order';

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
        baseParticipant({ id: 'stalker2', name: 'Stalker 2', initiative: 5, currentHitPoints: 0, isDead: true }),
        baseParticipant({ id: 'hero', name: 'The Veteran', participantType: 'player', initiative: 15 }),
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
        baseParticipant({ id: 'hero', name: 'The Veteran', participantType: 'player', initiative: 15 }),
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
        baseParticipant({ id: 'hero', name: 'The Veteran', participantType: 'player', initiative: 15 }),
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
        baseParticipant({ id: 'stalker2', name: 'Stalker 2', initiative: 5, currentHitPoints: 0, isDead: true }),
        baseParticipant({ id: 'hero', name: 'The Veteran', participantType: 'player', initiative: 15 }),
      ],
    });
    expect(summary).not.toBeNull();
    // Stalker 1 (initiative 20) acted before the hero; Stalker 2 is dead and must not count.
    expect(actedCount(summary!)).toBe(1);
  });
});
