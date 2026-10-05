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

  it('returns the newest persisted machine-readable roll outcome', async () => {
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
      ...createDefaultSessionState(sessionId),
      combatLog: [
        {
          timestamp: '2026-08-15T00:00:00.000Z',
          entry: { kind: 'roll_result', payload: { total: 18 } },
        },
        {
          timestamp: '2026-08-15T00:01:00.000Z',
          entry: {
            kind: 'roll_result',
            payload: {
              total: 13,
              dc: 15,
              success: false,
              requestType: 'skill_check',
              description: 'Acrobatics Check',
            },
          },
        },
      ],
    });

    await expect(SessionStateService.getLatestRollOutcome(sessionId)).resolves.toEqual({
      total: 13,
      dc: 15,
      success: false,
      requestType: 'skill_check',
      description: 'Acrobatics Check',
      timestamp: '2026-08-15T00:01:00.000Z',
    });
  });

  it('scans past a newer text-parsed roll mention to the newest authoritative outcome', async () => {
    // The exact sequence that broke roll memory: a real engine roll, then the player
    // typing "I rolled 17", which logTextRollResult logs as a roll_result with no
    // success flag. The typed mention must not shadow the engine roll below it.
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
      ...createDefaultSessionState(sessionId),
      combatLog: [
        {
          timestamp: '2026-08-15T00:00:00.000Z',
          entry: {
            kind: 'roll_result',
            payload: { success: false, total: 9, requestType: 'attack' },
          },
        },
        {
          timestamp: '2026-08-15T00:01:00.000Z',
          entry: { kind: 'roll_result', payload: { total: 17, raw: 'I rolled 17' } },
        },
      ],
    });

    await expect(SessionStateService.getLatestRollOutcome(sessionId)).resolves.toEqual({
      success: false,
      total: 9,
      requestType: 'attack',
      timestamp: '2026-08-15T00:00:00.000Z',
    });
  });

  it('never treats a text-parsed roll mention as an outcome on its own', async () => {
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
      ...createDefaultSessionState(sessionId),
      combatLog: [
        {
          timestamp: '2026-08-15T00:01:00.000Z',
          entry: { kind: 'roll_result', payload: { total: 17, raw: 'I rolled 17' } },
        },
      ],
    });

    await expect(SessionStateService.getLatestRollOutcome(sessionId)).resolves.toBeNull();
  });

  it('scans past a roll_result whose payload is not an object', async () => {
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
      ...createDefaultSessionState(sessionId),
      combatLog: [
        {
          timestamp: '2026-08-15T00:00:00.000Z',
          entry: {
            kind: 'roll_result',
            payload: { success: true, total: 20, requestType: 'saving_throw' },
          },
        },
        {
          timestamp: '2026-08-15T00:01:00.000Z',
          entry: { kind: 'roll_result', payload: 'rolled 20' },
        },
      ],
    });

    await expect(SessionStateService.getLatestRollOutcome(sessionId)).resolves.toEqual({
      success: true,
      total: 20,
      requestType: 'saving_throw',
      timestamp: '2026-08-15T00:00:00.000Z',
    });
  });

  it('stops at a newer real roll that carries no outcome instead of surfacing an older one', async () => {
    // A dice roll without a DC has no success flag (dice-roll-formatter only sets one
    // when the roll has a DC or an attack AC). It is still a real roll: the scan must
    // stop there, not fall through to a stale outcome from an earlier turn.
    vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
      ...createDefaultSessionState(sessionId),
      combatLog: [
        {
          timestamp: '2026-08-15T00:00:00.000Z',
          entry: {
            kind: 'roll_result',
            payload: {
              formula: '1d20+2',
              count: 1,
              dieType: 20,
              modifier: 2,
              total: 11,
              naturalRoll: 9,
              requestType: 'skill_check',
              description: 'Acrobatics Check',
              dc: 15,
              success: false,
            },
          },
        },
        {
          timestamp: '2026-08-15T00:01:00.000Z',
          entry: {
            kind: 'roll_result',
            payload: {
              formula: '1d20+3',
              count: 1,
              dieType: 20,
              modifier: 3,
              total: 14,
              naturalRoll: 11,
              requestType: 'skill_check',
              description: 'Athletics Check',
            },
          },
        },
      ],
    });

    await expect(SessionStateService.getLatestRollOutcome(sessionId)).resolves.toBeNull();
  });
});
