import { describe, expect, it, vi } from 'vitest';

import { ACTION_BAR_CAST_INTENT } from '../../../../shared/test-fixtures/combat-action-bar-intent';
import { QUICKENED_SPELL_PROPOSAL } from '../../../../shared/test-fixtures/quickened-spell-proposal';
import { askPlayerForSpellCast } from '../player-spell-cast';

const fetchSpy = vi.hoisted(() => vi.fn());
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: fetchSpy,
  SessionExpiredError: class extends Error {},
}));
vi.mock('@/infrastructure/api/request-id-log', () => ({ logServerRequestId: vi.fn() }));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(async () => ({ d20: 12 })),
}));
vi.mock('@/services/combat/spell-target-save-bridge', () => ({ requestSpellTargetSave: vi.fn() }));

describe('Quickened spell proposal wire', () => {
  it('sends the exact body accepted by the intent route', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        proposal: {
          movementOnly: false,
          spellId: 'chill-touch',
          spellName: 'Chill Touch',
          kind: 'attack',
          attackBonus: 5,
          saveDC: 13,
          targetAc: 14,
          advantage: false,
          disadvantage: false,
        },
      }),
    });
    await askPlayerForSpellCast({
      encounterId: 'encounter',
      action: { ...ACTION_BAR_CAST_INTENT, metamagic: 'quickened' },
      actorLabel: 'Hero',
      participants: [
        { id: QUICKENED_SPELL_PROPOSAL.intent.actorId, name: 'Hero' },
        { id: QUICKENED_SPELL_PROPOSAL.intent.targetIds[0], name: 'Enemy' },
      ],
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual(QUICKENED_SPELL_PROPOSAL);
  });
});
