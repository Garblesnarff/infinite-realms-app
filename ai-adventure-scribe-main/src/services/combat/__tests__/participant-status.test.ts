import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetCombatParticipantStatus } = vi.hoisted(() => ({
  mockGetCombatParticipantStatus: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCombatParticipantStatus: mockGetCombatParticipantStatus,
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

import { getParticipantStatus } from '../participant-status';

const statusResponse = {
  participant_id: 'participant-1',
  encounter_id: 'encounter-1',
  current_hp: 10,
  max_hp: 20,
  temp_hp: 5,
  is_conscious: true,
  death_saves_successes: 0,
  death_saves_failures: 0,
  damage_resistances: ['fire'],
  damage_immunities: ['cold'],
  damage_vulnerabilities: ['acid'],
};

describe('getParticipantStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the ownership-scoped server status response', async () => {
    mockGetCombatParticipantStatus.mockResolvedValue(statusResponse);

    const result = await getParticipantStatus('participant-1');

    expect(result).toEqual({
      current_hp: 10,
      max_hp: 20,
      temp_hp: 5,
      is_conscious: true,
      damage_resistances: ['fire'],
      damage_immunities: ['cold'],
      damage_vulnerabilities: ['acid'],
    });
    expect(mockGetCombatParticipantStatus).toHaveBeenCalledWith('participant-1');
  });

  it('returns null when the server masks a missing or unauthorized participant', async () => {
    mockGetCombatParticipantStatus.mockRejectedValue(new Error('Not found'));

    await expect(getParticipantStatus('missing')).resolves.toBeNull();
  });

  it('returns null and logs when the server request fails', async () => {
    mockGetCombatParticipantStatus.mockRejectedValue(new Error('Network failure'));

    await expect(getParticipantStatus('participant-1')).resolves.toBeNull();
  });

  it('returns null for an unusable response', async () => {
    mockGetCombatParticipantStatus.mockResolvedValue(null);

    await expect(getParticipantStatus('participant-1')).resolves.toBeNull();
  });
});
