import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingIntentConfirmation } from '../PendingIntentConfirmation';

import type { CombatEncounter } from '@/types/combat';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    clearPendingCombatIntent: vi.fn(),
    promotePendingCombatIntent: vi.fn(),
  },
}));

const makeEncounter = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'encounter-1',
  sessionId: 'session-1',
  phase: 'active',
  currentRound: 2,
  currentTurnParticipantId: 'player-1',
  participants: [
    {
      id: 'player-1',
      characterId: 'character-1',
      name: 'The Storyteller',
      participantType: 'player',
      isActive: true,
      currentHitPoints: 20,
      isUnconscious: false,
    },
    {
      id: 'vance-1',
      name: 'Vance',
      participantType: 'npc',
      isActive: true,
      currentHitPoints: 12,
      isUnconscious: false,
    },
  ],
  pendingIntent: {
    actorId: 'player-1',
    actionType: 'attack',
    targetIds: ['vance'],
    sourceText: 'I punch Vance',
    queuedOnTurn: 0,
    queuedOnRound: 1,
  },
  ...overrides,
});

const renderConfirmation = (
  encounter = makeEncounter(),
): { onRefresh: ReturnType<typeof vi.fn>; onSendFullMessage: ReturnType<typeof vi.fn> } => {
  const onRefresh = vi.fn().mockResolvedValue(encounter);
  const onSendFullMessage = vi.fn().mockResolvedValue(undefined);
  render(
    <PendingIntentConfirmation
      encounter={encounter as unknown as CombatEncounter}
      onRefresh={onRefresh}
      onSendFullMessage={onSendFullMessage}
    />,
  );
  return { onRefresh, onSendFullMessage };
};

describe('PendingIntentConfirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userDataApi.clearPendingCombatIntent).mockResolvedValue({ ok: true } as Response);
    vi.mocked(userDataApi.promotePendingCombatIntent).mockResolvedValue({
      ok: true,
      json: async () => ({ pendingIntent: { sourceText: 'I punch Vance' } }),
    } as Response);
  });

  it('promotes the stored declaration and sends its source text through normal resolution', async () => {
    const user = userEvent.setup();
    const { onRefresh, onSendFullMessage } = renderConfirmation();

    await user.click(screen.getByRole('button', { name: '[Strike]' }));

    await waitFor(() => {
      expect(userDataApi.promotePendingCombatIntent).toHaveBeenCalledWith('encounter-1');
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(onSendFullMessage).toHaveBeenCalledWith('I punch Vance');
    });
    expect(userDataApi.clearPendingCombatIntent).not.toHaveBeenCalled();
  });

  it('offers only Do something else when the named target is dead', async () => {
    const user = userEvent.setup();
    const encounter = makeEncounter({
      participants: [
        {
          id: 'player-1',
          characterId: 'character-1',
          name: 'The Storyteller',
          participantType: 'player',
          isActive: true,
          currentHitPoints: 20,
        },
        {
          id: 'vance-1',
          name: 'Vance',
          participantType: 'npc',
          isActive: true,
          currentHitPoints: 0,
          isDead: true,
        },
      ],
    });
    const { onRefresh } = renderConfirmation(encounter);

    expect(screen.queryByRole('button', { name: '[Strike]' })).toBeNull();
    const doSomethingElse = screen.getByRole('button', { name: '[Do something else]' });
    expect(screen.getByText(/Vance is no longer available as a target/)).toBeDefined();

    await user.click(doSomethingElse);
    await waitFor(() => {
      expect(userDataApi.clearPendingCombatIntent).toHaveBeenCalledWith('encounter-1');
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
    expect(userDataApi.promotePendingCombatIntent).not.toHaveBeenCalled();
  });

  it('does not render before the pending actor owns the current turn', () => {
    const encounter = makeEncounter({ currentTurnParticipantId: 'vance-1' });
    renderConfirmation(encounter);

    expect(screen.queryByRole('alert', { name: 'Pending combat action' })).toBeNull();
  });
});
