import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionStateService } from '../session-state-service';

import { userDataApi } from '@/services/user-data-api';
import { createDefaultSessionState } from '@/types/session-state';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { getSession: vi.fn(), updateSession: vi.fn() },
}));

describe('SessionStateService', () => {
  const sessionId = 'test-session-id';
  const now = '2024-05-24T12:00:00.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  });

  it('loads state through the owned session route', async () => {
    const state = { ...createDefaultSessionState(sessionId), scene: 'Current Scene' };
    vi.mocked(userDataApi.getSession).mockResolvedValue({ id: sessionId, session_state: state });

    await expect(SessionStateService.getState(sessionId)).resolves.toEqual(state);
    expect(userDataApi.getSession).toHaveBeenCalledWith(sessionId);
  });

  it('returns default state when the route fails or has no snapshot', async () => {
    vi.mocked(userDataApi.getSession).mockRejectedValue(new Error('Not found'));
    await expect(SessionStateService.getState(sessionId)).resolves.toEqual(
      createDefaultSessionState(sessionId),
    );
  });

  it('merges and persists partial state through the session route', async () => {
    const current = createDefaultSessionState(sessionId);
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue(current);

    const result = await SessionStateService.updateState(sessionId, { scene: 'New Scene' });

    const expected = { ...current, scene: 'New Scene', lastUpdate: now };
    expect(result).toEqual(expected);
    expect(userDataApi.updateSession).toHaveBeenCalledWith(sessionId, { session_state: expected });
  });

  it('returns the merged state when persistence fails', async () => {
    const current = createDefaultSessionState(sessionId);
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue(current);
    vi.mocked(userDataApi.updateSession).mockRejectedValue(new Error('offline'));

    await expect(
      SessionStateService.updateState(sessionId, { scene: 'Local' }),
    ).resolves.toMatchObject({
      scene: 'Local',
      lastUpdate: now,
    });
  });

  it('appends and trims combat log entries through the session route', async () => {
    const current = {
      ...createDefaultSessionState(sessionId),
      combatLog: Array.from({ length: 3 }, (_, index) => ({ timestamp: 'old', entry: index })),
    };
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue(current);

    await SessionStateService.appendCombatLog(sessionId, 'new', 2);

    expect(userDataApi.updateSession).toHaveBeenCalledWith(sessionId, {
      session_state: expect.objectContaining({
        combatLog: [
          { timestamp: 'old', entry: 2 },
          { timestamp: now, entry: 'new' },
        ],
        lastUpdate: now,
      }),
    });
  });

  it('fails safely when combat-log persistence is unavailable', async () => {
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue(
      createDefaultSessionState(sessionId),
    );
    vi.mocked(userDataApi.updateSession).mockRejectedValue(new Error('offline'));
    await expect(SessionStateService.appendCombatLog(sessionId, 'entry')).resolves.toBeUndefined();
  });

  it('delegates roll events to the combat log', async () => {
    const append = vi.spyOn(SessionStateService, 'appendCombatLog').mockResolvedValue();
    await SessionStateService.appendRollEvent(sessionId, { kind: 'attack', payload: { roll: 15 } });
    expect(append).toHaveBeenCalledWith(sessionId, { kind: 'attack', payload: { roll: 15 } });
  });
});
