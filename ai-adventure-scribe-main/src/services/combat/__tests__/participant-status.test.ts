import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchWithAuth } = vi.hoisted(() => ({ mockFetchWithAuth: vi.fn() }));
vi.mock('@/infrastructure/api/rest-client', () => ({ fetchWithAuth: mockFetchWithAuth }));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn().mockResolvedValue(undefined) }));

import { userDataApi } from '@/services/user-data-api';

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

describe('participant status through the live API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the ownership-scoped server status response', async () => {
    mockFetchWithAuth.mockResolvedValue(new Response(JSON.stringify(statusResponse)));
    expect(await userDataApi.getCharacterCombatStatus('participant-1')).toEqual(statusResponse);
    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      '/v1/combat/characters/participant-1/combat-status',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } }),
    );
  });

  it('reports a missing or unauthorized participant', async () => {
    mockFetchWithAuth.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    await expect(userDataApi.getCharacterCombatStatus('missing')).rejects.toThrow(
      'Not found (404)',
    );
  });

  it('reports a failed server request', async () => {
    mockFetchWithAuth.mockRejectedValue(new Error('Network failure'));
    await expect(userDataApi.getCharacterCombatStatus('participant-1')).rejects.toThrow(
      'Network failure',
    );
  });
});
