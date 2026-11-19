import { describe, expect, it, vi } from 'vitest';

import { SECOND_WIND_SHEET_BODY } from '../../../shared/test-fixtures/second-wind-sheet';

import { userDataApi } from '@/services/user-data-api';

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchSpy,
  SessionExpiredError: class extends Error {},
}));
vi.mock('@/infrastructure/api/request-id-log', () => ({ logServerRequestId: vi.fn() }));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn(async () => undefined) }));

describe('Second Wind sheet wire (#1576)', () => {
  it('the sheet sends exactly the shared body to the second-wind route', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        roll: 4,
        fighterLevel: 1,
        healed: 5,
        newHp: 12,
        maxHp: 12,
        usesRemaining: 0,
      }),
    });
    const result = await userDataApi.secondWind('char-1');
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(url).toContain('/v1/characters/char-1/second-wind');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(SECOND_WIND_SHEET_BODY);
    expect(result.newHp).toBe(12);
  });
});
