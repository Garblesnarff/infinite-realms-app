/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveCombatEncounter } = vi.hoisted(() => ({
  saveCombatEncounter: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { saveCombatEncounter },
}));

import { saveEncounterToDatabase } from '../persistence';

describe('saveEncounterToDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveCombatEncounter.mockResolvedValue({
      ok: true,
      encounterId: 'encounter-123',
      participants: 2,
      statuses: 2,
      conditions: 2,
      skippedConditions: [],
    });
    vi.stubEnv('VITE_ENABLE_COMBAT_DB', 'true');
  });

  it('does nothing if VITE_ENABLE_COMBAT_DB is not enabled', async () => {
    vi.stubEnv('VITE_ENABLE_COMBAT_DB', 'false');

    await saveEncounterToDatabase({
      id: 'encounter-123',
      sessionId: 'session-456',
      phase: 'active',
      currentRound: 1,
      currentTurnParticipantId: 'p-1',
      participants: [],
      actions: [],
      roundsElapsed: 1,
      startTime: new Date(),
    } as any);

    expect(saveCombatEncounter).not.toHaveBeenCalled();
  });

  it('sends the full snapshot to the authenticated server route', async () => {
    const encounter = {
      id: 'encounter-123',
      sessionId: 'session-456',
      phase: 'active',
      currentRound: 1,
      currentTurnParticipantId: 'p-1',
      location: 'Dungeon Room 1',
      startTime: new Date('2026-03-09T12:00:00.000Z'),
      participants: [
        {
          id: 'p-1',
          characterId: 'char-1',
          name: 'Fighter',
          participantType: 'player',
          initiative: 15,
          initiativeBonus: 2,
          currentHitPoints: 20,
          maxHitPoints: 30,
          temporaryHitPoints: 5,
          armorClass: 16,
          speed: 30,
          damageResistances: [],
          damageImmunities: [],
          damageVulnerabilities: [],
          deathSaves: { successes: 0, failures: 0 },
          conditions: [
            { name: 'Poisoned', source: 'Spider Bite', remainingDuration: 3 },
            { name: 'Prone', source: 'Tripped' },
          ],
        },
        {
          id: 'p-2',
          characterId: null,
          name: 'Goblin',
          participantType: 'npc',
          initiative: 12,
          initiativeBonus: 1,
          currentHitPoints: 0,
          maxHitPoints: 10,
          temporaryHitPoints: 0,
          armorClass: 12,
          speed: 30,
          damageResistances: [],
          damageImmunities: [],
          damageVulnerabilities: [],
          deathSaves: { successes: 0, failures: 3 },
          conditions: [],
        },
      ],
    } as any;

    await saveEncounterToDatabase(encounter);

    expect(saveCombatEncounter).toHaveBeenCalledOnce();
    expect(saveCombatEncounter).toHaveBeenCalledWith(
      'encounter-123',
      expect.objectContaining({
        sessionId: 'session-456',
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        location: 'Dungeon Room 1',
        startedAt: '2026-03-09T12:00:00.000Z',
        participants: expect.arrayContaining([
          expect.objectContaining({
            id: 'p-1',
            characterId: 'char-1',
            participantType: 'player',
            initiativeModifier: 2,
            turnOrder: 0,
            isActive: true,
            maxHp: 30,
          }),
          expect.objectContaining({
            id: 'p-2',
            characterId: null,
            turnOrder: 1,
            isActive: false,
          }),
        ]),
        statuses: expect.arrayContaining([
          expect.objectContaining({
            participantId: 'p-1',
            currentHp: 20,
            maxHp: 30,
            tempHp: 5,
            isConscious: true,
          }),
          expect.objectContaining({
            participantId: 'p-2',
            currentHp: 0,
            isConscious: false,
            deathSavesFailures: 3,
          }),
        ]),
        conditions: expect.arrayContaining([
          expect.objectContaining({
            participantId: 'p-1',
            conditionName: 'Poisoned',
            source: 'Spider Bite',
            durationRounds: 3,
          }),
          expect.objectContaining({
            participantId: 'p-1',
            conditionName: 'Prone',
            source: 'Tripped',
            durationRounds: null,
          }),
        ]),
      }),
    );
  });
});
