/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyHealingFromRoll } from '../healing-applicator';
import { getParticipantStatus } from '../participant-status';

const { mockUpdateCombatParticipantStatus } = vi.hoisted(() => ({
  mockUpdateCombatParticipantStatus: vi.fn(),
}));

vi.mock('../participant-status', () => ({
  getParticipantStatus: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    updateCombatParticipantStatus: mockUpdateCombatParticipantStatus,
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('applyHealingFromRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCombatParticipantStatus.mockResolvedValue({});
  });

  it('applies healing correctly when conscious', async () => {
    const mockStatus = {
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    };
    (getParticipantStatus as any).mockResolvedValue(mockStatus);

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5,
    });

    expect(result.success).toBe(true);
    expect(result.newHP).toBe(15);
    expect(result.healingApplied).toBe(5);
    expect(result.becameConscious).toBe(false);
    expect(mockUpdateCombatParticipantStatus).toHaveBeenCalledWith('test-id', {
      currentHp: 15,
      isConscious: true,
    });
  });

  it('caps healing at max HP', async () => {
    (getParticipantStatus as any).mockResolvedValue({
      current_hp: 18,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 10,
    });

    expect(result.newHP).toBe(20);
    expect(result.healingApplied).toBe(2);
  });

  it('resets death saves and marks a participant conscious when healing from 0 HP', async () => {
    (getParticipantStatus as any).mockResolvedValue({
      current_hp: 0,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: false,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5,
    });

    expect(result.success).toBe(true);
    expect(result.newHP).toBe(5);
    expect(result.becameConscious).toBe(true);
    expect(mockUpdateCombatParticipantStatus).toHaveBeenCalledWith('test-id', {
      currentHp: 5,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });
  });

  it('returns failure if participant status is not found', async () => {
    (getParticipantStatus as any).mockResolvedValue(null);

    const result = await applyHealingFromRoll({
      participantId: 'unknown-id',
      healingAmount: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Participant status not found');
  });

  it('handles server update errors', async () => {
    (getParticipantStatus as any).mockResolvedValue({
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });
    mockUpdateCombatParticipantStatus.mockRejectedValue(new Error('Update failed'));

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Update failed');
  });

  it('handles non-Error failures', async () => {
    (getParticipantStatus as any).mockResolvedValue({
      current_hp: 10,
      max_hp: 20,
      temp_hp: 0,
      is_conscious: true,
      damage_resistances: [],
      damage_immunities: [],
      damage_vulnerabilities: [],
    });
    mockUpdateCombatParticipantStatus.mockRejectedValue('String error');

    const result = await applyHealingFromRoll({
      participantId: 'test-id',
      healingAmount: 5,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unknown error');
  });
});
