import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearCombatEntryTurnConfirmed,
  markCombatEntryTurnConfirmed,
  startCombatEntryDelivery,
  type DeliverableCombatEntry,
} from '../combat-entry-delivery';

import { confirmCombatEntry } from '@/hooks/ai/combat-entry-hold';
import { requestPlayerInitiativeRoll } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/hooks/ai/combat-entry-hold', () => ({
  confirmCombatEntry: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerInitiativeRoll: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getActiveCombat: vi.fn(),
    enterCombat: vi.fn(),
    declinePendingCombatEntry: vi.fn(),
  },
}));

const PENDING = {
  trigger: 'tactical_action',
  detail: 'combat_action attack',
  combatants: [{ name: 'Goblin', count: 1 }],
  sceneSpec: { environment: 'dungeon_room' },
  sceneSpecSynthesized: true,
} as DeliverableCombatEntry;

const PLAYER = { characterId: 'char-1', name: 'Rook', initiativeModifier: 2 };

function http(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('startCombatEntryDelivery (#913)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmCombatEntry).mockResolvedValue(true);
    vi.mocked(requestPlayerInitiativeRoll).mockResolvedValue({ d20: 12 });
    vi.mocked(userDataApi.getActiveCombat).mockResolvedValue(http(200, { combat: null }));
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(http(201, { encounter: { id: 'enc-1' } }));
    vi.mocked(userDataApi.declinePendingCombatEntry).mockResolvedValue(
      http(200, { cleared: true }),
    );
  });

  it('shares one enter when the poll and the handler seat the same actors', async () => {
    const poll = startCombatEntryDelivery({
      sessionId: 'session-share',
      pending: PENDING,
      player: PLAYER,
    });
    const handlerConfirm = vi.fn(async () => true);
    const handler = startCombatEntryDelivery({
      sessionId: 'session-share',
      pending: PENDING,
      player: PLAYER,
      confirm: handlerConfirm,
      rollInitiative: async () => ({ d20: 15 }),
    });

    expect(handler).toBe(poll);
    await expect(poll).resolves.toMatchObject({ kind: 'seated', encounterId: 'enc-1' });
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    expect(handlerConfirm).not.toHaveBeenCalled();
    clearCombatEntryTurnConfirmed('session-share');
  });

  it('returns already-seated when enter is refused and the active combat names the encounter', async () => {
    vi.mocked(userDataApi.getActiveCombat)
      .mockResolvedValueOnce(http(200, { combat: null }))
      .mockResolvedValueOnce(http(200, { combat: { encounter: { id: 'enc-9' } } }));
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(http(409, { error: 'gone' }));

    const result = await startCombatEntryDelivery({
      sessionId: 'session-409',
      pending: PENDING,
      player: PLAYER,
      confirm: async () => true,
      rollInitiative: async () => ({ d20: 4 }),
    });

    expect(result).toEqual({ kind: 'already-seated', encounterId: 'enc-9' });
    expect(userDataApi.declinePendingCombatEntry).toHaveBeenCalledWith('session-409');
  });

  it('does not reuse a declined poll when the same actors are attacked on a later turn', async () => {
    markCombatEntryTurnConfirmed('session-next');
    vi.mocked(confirmCombatEntry).mockResolvedValue(false);

    await expect(
      startCombatEntryDelivery({
        sessionId: 'session-next',
        pending: PENDING,
        player: PLAYER,
      }),
    ).resolves.toEqual({ kind: 'declined' });

    markCombatEntryTurnConfirmed('session-next');
    const confirm = vi.fn(async () => true);
    const result = await startCombatEntryDelivery({
      sessionId: 'session-next',
      pending: PENDING,
      player: PLAYER,
      confirm,
      rollInitiative: async () => ({ d20: 8 }),
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: 'seated', encounterId: 'enc-1' });
    clearCombatEntryTurnConfirmed('session-next');
  });
});
