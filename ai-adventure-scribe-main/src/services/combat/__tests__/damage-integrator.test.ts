/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateModifiedDamage,
  applyDamageFromRoll,
  applyHealingFromRoll,
  applyDamageFromAutoRoll,
} from '../damage-integrator';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ error: null })),
      })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

// Mock logger to keep test output clean
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('DamageIntegrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateModifiedDamage', () => {
    it('should return base damage when no modifiers apply', () => {
      const result = calculateModifiedDamage(10, 'slashing', [], [], []);
      expect(result).toBe(10);
    });

    it('should return 0 when immune', () => {
      const result = calculateModifiedDamage(10, 'fire', [], ['fire'], []);
      expect(result).toBe(0);
    });

    it('should return half damage (floored) when resistant', () => {
      const result1 = calculateModifiedDamage(10, 'cold', ['cold'], [], []);
      expect(result1).toBe(5);

      const result2 = calculateModifiedDamage(11, 'cold', ['cold'], [], []);
      expect(result2).toBe(5); // floor(11/2) = 5
    });

    it('should return double damage when vulnerable', () => {
      const result = calculateModifiedDamage(10, 'radiant', [], [], ['radiant']);
      expect(result).toBe(20);
    });

    it('should apply BOTH resistance and vulnerability', () => {
      // D&D 5e: 11 damage -> Resistance (5) -> Vulnerability (10)
      // This is expected to fail with the current implementation which returns 5
      const result = calculateModifiedDamage(11, 'necrotic', ['necrotic'], [], ['necrotic']);
      expect(result).toBe(10);
    });
  });

  describe('applyDamageFromRoll', () => {
    const mockParticipantId = 'p1';
    const mockEncounterId = 'e1';

    it('should apply damage and update HP correctly', async () => {
      // Setup mocks
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 20,
          max_hp: 30,
          temp_hp: 0,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');

      // Combined call to combat_participants with joined status
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });
      // Second call to update
      const updateMock = vi.fn().mockReturnThis();
      (fromSpy as any).mockReturnValueOnce({
        update: updateMock,
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      // Third call to log
      (fromSpy as any).mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 5,
        damageType: 'piercing',
        roundNumber: 1,
      });

      expect(result.success).toBe(true);
      expect(result.newHP).toBe(15);
      expect(result.previousHP).toBe(20);
      expect(result.damageDealt).toBe(5);
      expect(result.becameUnconscious).toBe(false);
    });

    it('should deplete temp HP before real HP', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 20,
          max_hp: 30,
          temp_hp: 10,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      // Mock update and insert too to avoid errors
      (fromSpy as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 15,
        damageType: 'bludgeoning',
        roundNumber: 1,
      });

      expect(result.tempHP).toBe(0);
      expect(result.newHP).toBe(15); // 15 total - 10 temp = 5 real damage. 20 - 5 = 15.
    });

    it('should partially deplete temp HP when damage is less than temp HP', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 20,
          max_hp: 30,
          temp_hp: 10,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      // Mock update and insert
      (fromSpy as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 5,
        damageType: 'bludgeoning',
        roundNumber: 1,
      });

      expect(result.tempHP).toBe(5);
      expect(result.newHP).toBe(20);
    });

    it('should set conscious to false when HP reaches 0', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 5,
          max_hp: 30,
          temp_hp: 0,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      // Mock update and insert
      (fromSpy as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 10,
        damageType: 'force',
        roundNumber: 1,
      });

      expect(result.newHP).toBe(0);
      expect(result.becameUnconscious).toBe(true);
    });

    it('should return no damage when immunity results in 0 damage', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: ['fire'],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 20,
          max_hp: 30,
          temp_hp: 0,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 10,
        damageType: 'fire',
        roundNumber: 1,
      });

      expect(result.damageDealt).toBe(0);
      expect(result.newHP).toBe(20);
    });

    it('should handle errors when participant status is not found', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await applyDamageFromRoll({
        participantId: 'non-existent',
        encounterId: mockEncounterId,
        damageAmount: 10,
        damageType: 'slashing',
        roundNumber: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('status not found');
    });

    it('should handle database errors in applyDamageFromRoll', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      // getParticipantStatus call
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            damage_resistances: [],
            damage_immunities: [],
            damage_vulnerabilities: [],
            combat_participant_status: { current_hp: 10, max_hp: 10, is_conscious: true },
          },
          error: null,
        }),
      });
      // update call
      (fromSpy as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockRejectedValue(new Error('Update failed')),
      });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 10,
        damageType: 'fire',
        roundNumber: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });

    it('should continue even if damage logging fails', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: { current_hp: 20, max_hp: 30, temp_hp: 0, is_conscious: true },
      };
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      // update call success
      (fromSpy as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });
      // log call FAIL
      (fromSpy as any).mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue({ error: { message: 'Log failed' } }),
      });

      const result = await applyDamageFromRoll({
        participantId: mockParticipantId,
        encounterId: mockEncounterId,
        damageAmount: 5,
        damageType: 'piercing',
        roundNumber: 1,
      });

      expect(result.success).toBe(true); // Should still succeed
      expect(result.newHP).toBe(15);
    });

    it('should handle status error in getParticipantStatus', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      });

      const result = await applyDamageFromRoll({
        participantId: 'p1',
        encounterId: 'e1',
        damageAmount: 5,
        damageType: 'piercing',
        roundNumber: 1,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Participant status not found');
    });
  });

  describe('applyDamageFromAutoRoll', () => {
    it('should correctly bridge auto-roll result to applyDamageFromRoll', async () => {
      const mockRollResult = {
        request: { actorName: 'Goblin', purpose: 'Shortsword' },
        result: { total: 7 },
      };

      // Mock dependencies for applyDamageFromRoll
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            damage_resistances: [],
            damage_immunities: [],
            damage_vulnerabilities: [],
            combat_participant_status: { current_hp: 10, max_hp: 10, temp_hp: 0, is_conscious: true },
          },
          error: null,
        }),
      });

      (fromSpy as any)
        .mockReturnValueOnce({
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null }),
        })
        .mockReturnValueOnce({
          insert: vi.fn().mockResolvedValue({ error: null }),
        });

      const result = await applyDamageFromAutoRoll(
        mockRollResult as any,
        'e1',
        'p1',
        'piercing',
        1,
      );

      expect(result.success).toBe(true);
      expect(result.damageDealt).toBe(7);
      expect(result.newHP).toBe(3);
    });
  });

  describe('applyHealingFromRoll', () => {
    it('should increase HP and cap at max HP', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 25,
          max_hp: 30,
          temp_hp: 0,
          is_conscious: true,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      // Mock update
      (fromSpy as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await applyHealingFromRoll({
        participantId: 'p1',
        healingAmount: 10,
      });

      expect(result.newHP).toBe(30);
      expect(result.healingApplied).toBe(5);
    });

    it('should bring a participant back to consciousness and reset death saves', async () => {
      const mockParticipantData = {
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        combat_participant_status: {
          current_hp: 0,
          max_hp: 30,
          temp_hp: 0,
          is_conscious: false,
        },
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockParticipantData, error: null }),
      });

      const updateMock = vi.fn().mockReturnThis();
      (fromSpy as any).mockReturnValueOnce({
        update: updateMock,
        eq: vi.fn().mockResolvedValue({ error: null }),
      });

      const result = await applyHealingFromRoll({
        participantId: 'p1',
        healingAmount: 1,
      });

      expect(result.becameConscious).toBe(true);
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          current_hp: 1,
          is_conscious: true,
          death_saves_successes: 0,
          death_saves_failures: 0,
        }),
      );
    });

    it('should return error when participant status not found', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await applyHealingFromRoll({
        participantId: 'non-existent',
        healingAmount: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Participant status not found');
    });

    it('should handle errors during healing application', async () => {
      const fromSpy = vi.spyOn(supabase, 'from');
      // getParticipantStatus call
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            damage_resistances: [],
            damage_immunities: [],
            damage_vulnerabilities: [],
            combat_participant_status: { current_hp: 0, max_hp: 10, is_conscious: false },
          },
          error: null,
        }),
      });
      // update call
      (fromSpy as any).mockReturnValueOnce({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockRejectedValue(new Error('Database error')),
      });

      const result = await applyHealingFromRoll({
        participantId: 'p1',
        healingAmount: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });
});
