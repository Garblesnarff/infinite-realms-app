/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyHealingFromRoll } from '../healing-applicator';
import { getParticipantStatus } from '../participant-status';

const mockEq = vi.fn().mockReturnThis();
const mockUpdate = vi.fn().mockReturnThis();
const mockFrom = vi.fn().mockReturnValue({
  update: mockUpdate,
  eq: mockEq
});

vi.mock('../participant-status', () => ({
  getParticipantStatus: vi.fn()
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => mockFrom(table)
  }
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

describe('applyHealingFromRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({
      update: mockUpdate,
      eq: mockEq
    });
    mockUpdate.mockReturnThis();
    mockEq.mockReturnThis();
  });

  it('should apply healing correctly when conscious', async () => {
    const mockStatus = {
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: []
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);
    mockEq.mockResolvedValue({ error: null });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5
    });

    expect(result.success).toBe(true);
    expect(result.newHP).toBe(15);
    expect(result.healingApplied).toBe(5);
    expect(result.becameConscious).toBe(false);

    expect(mockFrom).toHaveBeenCalledWith('combat_participant_status');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      current_hp: 15,
      is_conscious: true
    }));
  });

  it('should cap healing at max HP', async () => {
    const mockStatus = {
      current_hp: 18,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: []
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);
    mockEq.mockResolvedValue({ error: null });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 10
    });

    expect(result.newHP).toBe(20);
    expect(result.healingApplied).toBe(2);
  });

  it('should reset death saves and mark as conscious when healing from 0 HP', async () => {
    const mockStatus = {
      current_hp: 0,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: false,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: []
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);
    mockEq.mockResolvedValue({ error: null });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5
    });

    expect(result.success).toBe(true);
    expect(result.newHP).toBe(5);
    expect(result.becameConscious).toBe(true);

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      current_hp: 5,
      is_conscious: true,
      death_saves_successes: 0,
      death_saves_failures: 0
    }));
  });

  it('should return failure if participant status is not found', async () => {
    (getParticipantStatus as any).mockResolvedValue(null);

    const result = await applyHealingFromRoll({
      participantId: 'unknown-id',
      healingAmount: 5
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Participant status not found');
  });

  it('should handle database update errors', async () => {
    const mockStatus = {
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: []
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);
    mockEq.mockResolvedValue({ error: new Error('Update failed') });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Update failed');
  });

  it('should handle non-Error catch cases', async () => {
    const mockStatus = {
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: []
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);
    mockEq.mockRejectedValue('String error');

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});
