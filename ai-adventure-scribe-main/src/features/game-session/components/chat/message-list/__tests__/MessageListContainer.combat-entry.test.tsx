import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../../ChatInput';
import { MessageListContainer } from '../MessageListContainer';

import { Z_INDEX } from '@/constants/z-index';
import {
  requestCombatEntryConfirmation,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({
    state: { activeEncounter: null },
    refreshCombatState: vi.fn(),
  }),
}));

vi.mock('../use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    batchProgress: null,
    rollRequest: null,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    lastRollRef: { current: null },
  }),
}));

vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('../MessageRenderer', () => ({ MessageRenderer: () => null }));

const SPEC = {
  actorLabel: 'The Storyteller',
  combatantLabels: ['Vance'],
  initiativeRoll: null,
  initiativeModifier: 2,
};

describe('MessageListContainer combat entry hit testing', () => {
  afterEach(() => {
    settlePendingCombatEntryConfirmation(false);
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, 'elementFromPoint');
  });

  it('keeps the Strike hit target above the composer and dice popup anchor', async () => {
    let confirmationPromise: Promise<boolean> | undefined;

    render(
      <div>
        <MessageListContainer
          messages={[]}
          messagesRef={createRef<HTMLDivElement>()}
          expandedMessages={new Set()}
          setExpandedMessages={vi.fn()}
          imageByMessage={{}}
          generatingFor={new Set()}
          genErrorByMessage={{}}
          onGenerateScene={vi.fn().mockResolvedValue(undefined)}
          onOptionSelect={vi.fn().mockResolvedValue(undefined)}
          onSendMessage={vi.fn().mockResolvedValue(undefined)}
          onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
          sessionId="session-1"
        />
        <div data-testid="composer">
          <ChatInput onSendMessage={vi.fn()} isDisabled={false} />
        </div>
      </div>,
    );

    await act(async () => {
      confirmationPromise = requestCombatEntryConfirmation(SPEC);
    });

    const overlay = await screen.findByTestId('combat-entry-confirmation-overlay');
    const composer = screen.getByTestId('composer');
    const strike = screen.getByRole('button', { name: '[Strike]' });
    vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      right: 700,
      bottom: 300,
      left: 100,
      width: 600,
      height: 200,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(composer, 'getBoundingClientRect').mockReturnValue({
      top: 320,
      right: 800,
      bottom: 600,
      left: 0,
      width: 800,
      height: 280,
      x: 0,
      y: 320,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(strike),
    });

    const strikeRect = strike.getBoundingClientRect();
    const elementAtStrike = document.elementFromPoint(strikeRect.left + 1, strikeRect.top + 1);
    expect(elementAtStrike).toBe(strike);
    expect(overlay).toHaveClass('bottom-40');
    expect(overlay).toHaveStyle({ zIndex: Z_INDEX.COMBAT_ENTRY_CONFIRMATION });
    expect(overlay.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      composer.getBoundingClientRect().top,
    );

    if (!elementAtStrike) throw new Error('No element found at the Strike button coordinates');
    fireEvent.click(elementAtStrike);
    if (!confirmationPromise) throw new Error('Combat entry confirmation was not requested');
    await expect(confirmationPromise).resolves.toBe(true);
  });
});
