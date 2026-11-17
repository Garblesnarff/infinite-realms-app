import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DAMAGE_WIRE_BODY,
  DM_DAMAGE_WIRE_BODY,
  HEAL_WIRE_BODY,
} from '../../../shared/test-fixtures/character-vitals-wire';
import { userDataApi } from '../user-data-api';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: async () => {} }));

/**
 * #621 Part A: the client must send exactly the shared wire bodies to the damage and heal
 * routes. The server test posts the same fixtures through the real route schema.
 */
describe('userDataApi vitals wire bodies (#621 Part A)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ currentHitPoints: 27, temporaryHitPoints: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('applyCharacterDamage posts exactly DAMAGE_WIRE_BODY to /damage', async () => {
    const fetchMock = stubFetch();

    await userDataApi.applyCharacterDamage('character-1', DAMAGE_WIRE_BODY.amount);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/characters/character-1/damage');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(DAMAGE_WIRE_BODY);
  });

  it('applyCharacterDamage posts exactly DM_DAMAGE_WIRE_BODY, with its damageType, from the DM control', async () => {
    const fetchMock = stubFetch();

    await userDataApi.applyCharacterDamage(
      'character-1',
      DM_DAMAGE_WIRE_BODY.amount,
      DM_DAMAGE_WIRE_BODY.damageType,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual(DM_DAMAGE_WIRE_BODY);
  });

  it('applyCharacterHealing posts exactly HEAL_WIRE_BODY to /heal', async () => {
    const fetchMock = stubFetch();

    await userDataApi.applyCharacterHealing('character-1', HEAL_WIRE_BODY.amount);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/characters/character-1/heal');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual(HEAL_WIRE_BODY);
  });
});
