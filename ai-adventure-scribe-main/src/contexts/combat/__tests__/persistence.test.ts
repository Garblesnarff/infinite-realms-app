/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { saveEncounterToDatabase } from '../persistence';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => {
  const upsertFn = vi.fn().mockImplementation(() => Promise.resolve({ data: null, error: null }));
  const fromFn = vi.fn().mockImplementation(() => ({
    upsert: upsertFn,
  }));

  return {
    supabase: {
      from: fromFn,
    },
  };
});

describe('saveEncounterToDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub VITE_ENABLE_COMBAT_DB to ensure the persistence logic is active
    vi.stubEnv('VITE_ENABLE_COMBAT_DB', 'true');
  });

  it('does nothing if VITE_ENABLE_COMBAT_DB is not enabled', async () => {
    vi.stubEnv('VITE_ENABLE_COMBAT_DB', 'false');

    const mockEncounter: any = {
      id: 'encounter-123',
      sessionId: 'session-456',
      phase: 'active',
      currentRound: 1,
      currentTurnParticipantId: 'p-1',
      participants: [],
      startTime: new Date(),
    };

    await saveEncounterToDatabase(mockEncounter);

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('saves combat encounter and batched participants, statuses, and conditions successfully', async () => {
    const mockEncounter: any = {
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
          participantType: 'pc',
          initiative: 15,
          initiativeBonus: 2,
          currentHitPoints: 20,
          maxHitPoints: 30,
          temporaryHitPoints: 5,
          armorClass: 16,
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
          armorClass: 12,
          deathSaves: { successes: 0, failures: 3 },
          conditions: [],
        },
      ],
    };

    const upsertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(supabase.from).mockImplementation((_table: string) => {
      return {
        upsert: upsertSpy,
      } as any;
    });

    await saveEncounterToDatabase(mockEncounter);

    // 1. Check combat_encounters upsert
    expect(supabase.from).toHaveBeenCalledWith('combat_encounters');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'encounter-123',
        session_id: 'session-456',
        status: 'active',
        current_round: 1,
        current_turn_order: 0,
        location: 'Dungeon Room 1',
        started_at: '2026-03-09T12:00:00.000Z',
      }),
    );

    // 2. Check combat_participants batch upsert
    expect(supabase.from).toHaveBeenCalledWith('combat_participants');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'p-1',
          encounter_id: 'encounter-123',
          character_id: 'char-1',
          name: 'Fighter',
          participant_type: 'pc',
          initiative: 15,
          initiative_modifier: 2,
          turn_order: 0,
          is_active: true,
          armor_class: 16,
          max_hp: 30,
        }),
        expect.objectContaining({
          id: 'p-2',
          encounter_id: 'encounter-123',
          character_id: null,
          name: 'Goblin',
          participant_type: 'npc',
          initiative: 12,
          initiative_modifier: 1,
          turn_order: 1,
          is_active: false,
          armor_class: 12,
          max_hp: 10,
        }),
      ]),
    );

    // 3. Check combat_participant_status batch upsert
    expect(supabase.from).toHaveBeenCalledWith('combat_participant_status');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          participant_id: 'p-1',
          current_hp: 20,
          max_hp: 30,
          temp_hp: 5,
          is_conscious: true,
          death_saves_successes: 0,
          death_saves_failures: 0,
        }),
        expect.objectContaining({
          participant_id: 'p-2',
          current_hp: 0,
          max_hp: 10,
          temp_hp: 0,
          is_conscious: false,
          death_saves_successes: 0,
          death_saves_failures: 3,
        }),
      ]),
    );

    // 4. Check combat_participant_conditions batch upsert
    expect(supabase.from).toHaveBeenCalledWith('combat_participant_conditions');
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          participant_id: 'p-1',
          condition_name: 'Poisoned',
          source: 'Spider Bite',
          duration_rounds: 3,
          is_active: true,
        }),
        expect.objectContaining({
          participant_id: 'p-1',
          condition_name: 'Prone',
          source: 'Tripped',
          duration_rounds: null,
          is_active: true,
        }),
      ]),
    );
  });
});
