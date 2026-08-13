import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(),
}));

import { waitForAuth } from '@/lib/auth-gate';
import { loadCachedSession } from '@/services/auth/TokenService';
import { userDataApi } from '@/services/user-data-api';

describe('userDataApi tactical transport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' });
  });

  it('preserves tactical endpoint paths, payloads, and non-OK responses', async () => {
    const response = {
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Refused' }),
    } as unknown as Response;
    fetchMock.mockResolvedValue(response);

    await expect(userDataApi.getTacticalMapContext('session id', 'entity/id')).resolves.toBe(
      response,
    );
    await expect(
      userDataApi.startStructuredCombat('session id', {
        participants: [
          { encounterId: '', characterId: 'character-1', name: 'Rook', initiativeModifier: 0 },
        ],
        sceneSpec: { width: 10, height: 10 },
      }),
    ).resolves.toBe(response);
    await expect(userDataApi.endTacticalMap('session id')).resolves.toBe(response);
    await expect(
      userDataApi.applyTacticalMapAction('session id', {
        action: 'move',
        entityId: 'entity/id',
        x: 2,
        y: 4,
      }),
    ).resolves.toBe(response);

    expect(waitForAuth).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/context/entity%2Fid',
      { headers: { Authorization: 'Bearer access-token' } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8888/v1/combat/sessions/session%20id/start',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({
          participants: [
            { encounterId: '', characterId: 'character-1', name: 'Rook', initiativeModifier: 0 },
          ],
          sceneSpec: { width: 10, height: 10 },
        }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/end',
      { method: 'POST', headers: { Authorization: 'Bearer access-token' } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/action',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({ action: 'move', entityId: 'entity/id', x: 2, y: 4 }),
      },
    );
  });

  it('routes combat damage logs through the authenticated persistence boundary', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, id: 'log-1' }),
    });
    const payload = {
      participantId: 'participant-1',
      damageAmount: 7,
      damageType: 'fire',
      sourceParticipantId: null,
      sourceDescription: 'test hit',
      roundNumber: 2,
    };

    await expect(userDataApi.logCombatDamage('encounter/id', payload)).resolves.toEqual({
      ok: true,
      id: 'log-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8888/v1/combat/encounters/encounter%2Fid/damage-log',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer access-token',
        },
        body: JSON.stringify(payload),
      },
    );
  });
});
