import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEATH_SAVE_WIRE_BODY } from '../../../../shared/test-fixtures/death-save-body';
import { submitDeathSave } from '../death-save-api';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchWithAuthMock,
}));

describe('submitDeathSave (#1811)', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
    fetchWithAuthMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        roll: 12,
        successes: 1,
        failures: 0,
        vitalState: 'dying',
        currentHitPoints: 0,
        maxHitPoints: 12,
        terminal: false,
        hours: null,
        engineLines: ['Death saving throw: 12 — success (1/3)'],
        engineCards: [],
      }),
    });
  });

  it('posts the shared wire body to the death-save route', async () => {
    await submitDeathSave('session-1');
    expect(fetchWithAuthMock).toHaveBeenCalledWith(
      '/v1/sessions/session-1/death-save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(DEATH_SAVE_WIRE_BODY),
      }),
    );
  });
});
