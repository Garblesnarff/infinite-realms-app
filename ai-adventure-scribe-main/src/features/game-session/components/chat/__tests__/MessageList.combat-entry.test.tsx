import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MessageList } from '../MessageList';

import {
  requestCombatEntryConfirmation,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    sendMessage: vi.fn().mockResolvedValue(undefined),
    hasMore: false,
    loadMore: vi.fn(),
    isFetchingMore: false,
  }),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: vi.fn().mockReturnValue(null) }),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
}));

vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'campaign-1' }) }));

vi.mock('../message-list/useImageGeneration', () => ({
  useImageGeneration: () => ({
    generatingFor: new Set(),
    imageByMessage: {},
    genErrorByMessage: {},
    handleGenerateScene: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../message-list/useScrollBehavior', () => ({ useScrollBehavior: vi.fn() }));

vi.mock('../message-list/use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    batchProgress: null,
    rollRequest: null,
    handleDiceRoll: vi.fn(),
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    lastRollRef: { current: null },
  }),
}));

vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('../message-list/MessageRenderer', () => ({ MessageRenderer: () => null }));

const SPEC = {
  actorLabel: 'The Storyteller',
  combatantLabels: ['Vance'],
  initiativeRoll: null,
  initiativeModifier: 2,
};

describe('MessageList combat-entry reservation', () => {
  afterEach(() => {
    settlePendingCombatEntryConfirmation(false);
    vi.restoreAllMocks();
  });

  it('adds card height plus a gap to the message-list bottom while pending, then removes it', async () => {
    render(<MessageList sessionId="session-1" suppressEmptyState />);
    const messageList = screen.getByRole('log');

    await act(async () => {
      void requestCombatEntryConfirmation(SPEC);
    });

    await waitFor(() => {
      expect(Number.parseFloat(messageList.style.paddingBottom)).toBeGreaterThan(0);
    });

    act(() => {
      settlePendingCombatEntryConfirmation(false);
    });

    await waitFor(() => expect(messageList.style.paddingBottom).toBe(''));
  });
});
