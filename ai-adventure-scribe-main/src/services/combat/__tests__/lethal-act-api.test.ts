import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LETHAL_ACT_TEXT,
  LETHAL_ACT_WIRE_BODY,
} from '../../../../shared/test-fixtures/lethal-act-body';
import { submitConfirmedLethalAct } from '../lethal-act-api';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

describe('submitConfirmedLethalAct (#468)', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        natural: 15,
        modifier: 0,
        total: 15,
        dc: 15,
        damage: 10,
        vitalState: 'standing',
        currentHitPoints: 10,
        maxHitPoints: 20,
        engineCard: { line: 'Dexterity saving throw: 15 vs DC 15, SUCCESS' },
      }),
    });
  });

  it('POSTs the shared { text } body to /v1/sessions/:id/lethal-act', async () => {
    await submitConfirmedLethalAct('session-1', LETHAL_ACT_TEXT);
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/v1/sessions/session-1/lethal-act',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(LETHAL_ACT_WIRE_BODY),
      }),
    );
    const sent = JSON.parse(fetchWithAuthMock.mock.calls[0][1].body as string);
    expect(sent).toEqual(LETHAL_ACT_WIRE_BODY);
  });
});
