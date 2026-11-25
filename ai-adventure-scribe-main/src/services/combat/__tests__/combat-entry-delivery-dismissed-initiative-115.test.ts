import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  headlessEntryEnterResponse,
  headlessEntryPending,
  HEADLESS_ENTRY_CHARACTER_ID,
} from '../../../../shared/test-fixtures/combat-entry-headless';
import { clearCombatEntryTurnConfirmed, startCombatEntryDelivery } from '../combat-entry-delivery';

import { confirmCombatEntry } from '@/hooks/ai/combat-entry-hold';
import { requestPlayerInitiativeRoll } from '@/services/combat/player-roll-bridge';
import { subscribeDismissedInitiativeRoll } from '@/services/combat/roll-outcome-display';
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

function http(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('combat-entry-delivery #115 dismissed initiative reports the engine total', () => {
  const PLAYER = { characterId: HEADLESS_ENTRY_CHARACTER_ID, name: 'Rook', initiativeModifier: 2 };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(confirmCombatEntry).mockResolvedValue('confirmed');
    vi.mocked(requestPlayerInitiativeRoll).mockResolvedValue({ d20: 12 });
    vi.mocked(userDataApi.getActiveCombat).mockResolvedValue(http(200, { combat: null }));
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(http(201, headlessEntryEnterResponse));
    vi.mocked(userDataApi.declinePendingCombatEntry).mockResolvedValue(
      http(200, { cleared: true }),
    );
  });

  it('publishes the fixture player participant initiative when dismissed', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDismissedInitiativeRoll(listener);

    const expectedTotal = (
      headlessEntryEnterResponse.participants as Array<Record<string, unknown>>
    ).find((p) => p.characterId === HEADLESS_ENTRY_CHARACTER_ID)?.initiative;
    expect(expectedTotal).toBe(16);

    const sessionId = 'session-dismissed-initiative-1';
    const result = await startCombatEntryDelivery({
      sessionId,
      pending: headlessEntryPending as never,
      player: PLAYER,
      entryConfirmed: true,
      rollInitiative: async () => ({ d20: null, dismissed: true, rollId: 'init-roll-1' }),
    });

    expect(result).toMatchObject({ kind: 'seated' });
    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    const body = vi.mocked(userDataApi.enterCombat).mock.calls[0][1];
    expect(body).not.toHaveProperty('playerInitiativeRoll');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ rollId: 'init-roll-1', total: expectedTotal });

    clearCombatEntryTurnConfirmed(sessionId);
    unsubscribe();
  });

  it('does not publish when the initiative roll timed out', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDismissedInitiativeRoll(listener);

    const sessionId = 'session-dismissed-initiative-timeout';
    await startCombatEntryDelivery({
      sessionId,
      pending: headlessEntryPending as never,
      player: PLAYER,
      entryConfirmed: true,
      rollInitiative: async () => ({ d20: null, timedOut: true }),
    });

    expect(listener).not.toHaveBeenCalled();
    clearCombatEntryTurnConfirmed(sessionId);
    unsubscribe();
  });

  it('does not publish when the player rolled a d20', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDismissedInitiativeRoll(listener);

    const sessionId = 'session-dismissed-initiative-rolled';
    await startCombatEntryDelivery({
      sessionId,
      pending: headlessEntryPending as never,
      player: PLAYER,
      entryConfirmed: true,
      rollInitiative: async () => ({ d20: 14 }),
    });

    expect(listener).not.toHaveBeenCalled();
    clearCombatEntryTurnConfirmed(sessionId);
    unsubscribe();
  });
  it('publishes the fixture player participant initiative when dismissed (no characterId)', async () => {
    const noCharResponse = {
      ...headlessEntryEnterResponse,
      participants: (headlessEntryEnterResponse.participants as Array<Record<string, unknown>>).map(
        (p) => ({ ...p, characterId: null }),
      ),
    };
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(http(201, noCharResponse));

    const listener = vi.fn();
    const unsubscribe = subscribeDismissedInitiativeRoll(listener);

    const sessionId = 'session-dismissed-initiative-no-char';
    const result = await startCombatEntryDelivery({
      sessionId,
      pending: headlessEntryPending as never,
      player: { characterId: null, name: 'Rook', initiativeModifier: 2 },
      entryConfirmed: true,
      rollInitiative: async () => ({ d20: null, dismissed: true, rollId: 'init-roll-1' }),
    });

    expect(result).toMatchObject({ kind: 'seated' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ rollId: 'init-roll-1', total: 16 });

    clearCombatEntryTurnConfirmed(sessionId);
    unsubscribe();
  });
});
