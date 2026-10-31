import { describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import logger from '@/lib/logger';

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/hooks/ai/combat-resolution-step', () => ({
  resolveDeclaredCombatActions: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
  requestPlayerInitiativeRoll: vi.fn(),
  trackPlayerRollDismissal: async (ask: () => Promise<unknown>) => ({
    value: await ask(),
    dismissed: false,
  }),
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
  combatBoundaryFromResult: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    enterCombat: vi.fn(),
  },
}));
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));

describe('null roll requests (#781)', () => {
  it('logs a real request and skips a null entry', async () => {
    await handleDmActionsAndTransitions({
      sessionId: 'session-1',
      result: {
        text: 'Steel rings.',
        combat_entry_pending: { trigger: 'tactical_action' },
        roll_requests: [null, { type: 'save' }],
      },
      characterRecord: { id: 'char-1' },
      activeEncounter: null,
      isInCombat: false,
      refreshCombatState: vi.fn(),
      aiContext: { gameState: {} },
      conversationHistory: [],
      playerMessage: 'I draw steel.',
    } as never);

    const cleared = vi
      .mocked(logger.warn)
      .mock.calls.filter((call) => call[0] === 'DM_ROLL_REQUEST_CLEARED');
    expect(cleared).toEqual([
      ['DM_ROLL_REQUEST_CLEARED', { reason: 'entry_no_player', type: 'save' }],
    ]);
  });
});
