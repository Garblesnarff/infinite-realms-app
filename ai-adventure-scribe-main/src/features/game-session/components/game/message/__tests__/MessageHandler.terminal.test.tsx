/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517 (round 3): the terminal-state report is held while a send is in
 * flight. The death state is set inside the killing turn, before the DM
 * reply and engine-row saves settle; reporting it immediately would make
 * the game screen unmount the handler mid-send. Once the turn settles,
 * the report goes up and the end state replaces a completed turn.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageHandler } from '../MessageHandler';

const logic = vi.hoisted(() => ({
  state: null as any,
}));

vi.mock('../use-message-handler-logic', () => ({
  useMessageHandlerLogic: () => logic.state,
}));

const terminalState = {
  state: 'party_defeated',
  encounterId: null,
  receivedAt: 1,
  finalLines: ['The Scholar is dead.'],
};

const baseLogic = (overrides: Record<string, unknown>): any => ({
  handleSendMessage: vi.fn(async () => {}),
  isProcessing: false,
  isReconnecting: false,
  isStillThinking: false,
  sendError: null,
  retrySendMessage: vi.fn(async () => {}),
  combatTurnUiState: {},
  resumeCombatTurn: vi.fn(async () => {}),
  terminalDeathState: null,
  ...overrides,
});

const renderHandler = (onTerminalDeathStateChange: (state: any) => void): any =>
  render(
    <MessageHandler
      sessionId="session-1"
      campaignId="camp-1"
      characterId="char-1"
      turnCount={3}
      updateGameSessionState={vi.fn(async () => {})}
      onTerminalDeathStateChange={onTerminalDeathStateChange}
    >
      {() => null}
    </MessageHandler>,
  );

describe('MessageHandler terminal report (#2517)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('holds the report while the killing turn is still sending, then reports when it settles', () => {
    const onChange = vi.fn();
    logic.state = baseLogic({ terminalDeathState: terminalState, isProcessing: true });

    const { rerender } = renderHandler(onChange);
    expect(onChange).not.toHaveBeenCalledWith(terminalState);
    expect(onChange).not.toHaveBeenCalled();

    // The turn settles (DM reply and engine rows saved): the report goes up.
    logic.state = baseLogic({ terminalDeathState: terminalState, isProcessing: false });
    rerender(
      <MessageHandler
        sessionId="session-1"
        campaignId="camp-1"
        characterId="char-1"
        turnCount={3}
        updateGameSessionState={vi.fn(async () => {})}
        onTerminalDeathStateChange={onChange}
      >
        {() => null}
      </MessageHandler>,
    );
    expect(onChange).toHaveBeenCalledWith(terminalState);
  });

  it('reports a restored fallen state immediately when no send is in flight', () => {
    const onChange = vi.fn();
    logic.state = baseLogic({ terminalDeathState: terminalState, isProcessing: false });

    renderHandler(onChange);

    expect(onChange).toHaveBeenCalledWith(terminalState);
  });

  it('reports null while the character lives', () => {
    const onChange = vi.fn();
    logic.state = baseLogic({ terminalDeathState: null, isProcessing: false });

    renderHandler(onChange);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
