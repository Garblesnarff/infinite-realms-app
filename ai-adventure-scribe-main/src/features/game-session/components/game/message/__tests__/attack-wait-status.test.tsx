/**
 * #2536: every send shows a neutral composer status within the send turn. That line is gone
 * once the roll tray, the engine line, or the turn's end (resolve, error, abort, session
 * expiry) replaces it. "Resolving your attack…" appears only after an attack die.
 * Send stays disabled for the whole pending turn. Typed text stays until the send resolves.
 *
 * The resolved-turn fixture copies the object `getAIResponse` returns on its success path
 * (`src/hooks/use-ai-response.ts`, the `return { text, sender: 'dm', context: { combat_transition } }`
 * at the end of the turn). Production always sets `context.combat_transition` (`?? 'none'`).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatInput } from '../../../chat/ChatInput';
import { MessageHandler } from '../MessageHandler';
import {
  ATTACK_WAIT_RESOLVING,
  DM_STILL_THINKING_TIMEOUT_MS,
  DM_TURN_TIMEOUT_MS,
  TURN_WAIT_WORKING,
} from '../use-message-handler-logic';

import type { ReactElement } from 'react';

import { SessionExpiredError } from '@/infrastructure/api/rest-client';

const {
  mockGetAIResponse,
  mockSendMessage,
  mockToast,
  mockMessages,
  mockValidateSession,
  mockGameState,
} = vi.hoisted(() => ({
  mockGetAIResponse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockToast: vi.fn(),
  mockMessages: [] as Array<{ text: string; sender: 'player' | 'dm' | 'system' }>,
  mockValidateSession: vi.fn().mockResolvedValue(true),
  mockGameState: {
    diceRollQueue: {
      currentRollId: null as string | null,
      pendingRolls: [] as Array<{
        id: string;
        requestType: string;
        description: string;
        rollConfig: { dieType: number; count: number; modifier: number };
        timestamp: Date;
        status: 'pending';
        combatAttackRoll?: boolean;
        combatInitiativeRoll?: boolean;
      }>,
    },
  },
}));

vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ extractMemories: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('@/hooks/use-ai-response', () => ({
  useAIResponse: () => ({ getAIResponse: mockGetAIResponse }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: mockMessages,
    sendMessage: mockSendMessage,
    updateMessage: vi.fn(),
    queueStatus: 'idle' as const,
    isLoading: false,
  }),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({ processAiResponse: vi.fn(), state: mockGameState }),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@/utils/safetyCommands', () => ({
  checkSafetyCommands: vi.fn().mockResolvedValue({ isSafetyCommand: false }),
  processSafetyCommand: vi.fn(),
}));
vi.mock('@/utils/diceCommandParser', () => ({
  parseDiceCommand: vi.fn().mockReturnValue(null),
  mightBeDiceCommand: () => false,
  getDiceCommandSuggestions: () => [],
}));
vi.mock('@/utils/chatSanitizer', () => ({ sanitizeDMText: (text: string) => text }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/game-session/components/game/session/SessionValidator', () => ({
  useSessionValidator: () => mockValidateSession,
}));

/** The success-path object `getAIResponse` builds. `combat_transition` is always present. */
function dmReplyFromGetAIResponse(text: string): {
  text: string;
  sender: 'dm';
  timestamp: string;
  context: {
    emotion: 'neutral';
    intent: 'response';
    combat_transition: 'none';
    scene_spec: false;
    npcRollResults: undefined;
    handouts: undefined;
    combatEngineBlocks: undefined;
    combatEnded: false;
  };
  narrationSegments: undefined;
  diceRolls: undefined;
  rollRequests: [];
  imageRequests: undefined;
  localNotice: undefined;
  localNotices: undefined;
  sceneSpec: null;
  combatDetection: {
    isCombat: false;
    confidence: 1;
    combatType: 'none';
    shouldStartCombat: false;
    shouldEndCombat: false;
    enemies: [];
    combatActions: [];
  };
} {
  return {
    text,
    sender: 'dm',
    timestamp: new Date(0).toISOString(),
    context: {
      emotion: 'neutral',
      intent: 'response',
      combat_transition: 'none',
      scene_spec: false,
      npcRollResults: undefined,
      handouts: undefined,
      combatEngineBlocks: undefined,
      combatEnded: false,
    },
    narrationSegments: undefined,
    diceRolls: undefined,
    rollRequests: [],
    imageRequests: undefined,
    localNotice: undefined,
    localNotices: undefined,
    sceneSpec: null,
    combatDetection: {
      isCombat: false,
      confidence: 1,
      combatType: 'none',
      shouldStartCombat: false,
      shouldEndCombat: false,
      enemies: [],
      combatActions: [],
    },
  };
}

const ATTACK = 'I attack the goblin';

describe('attack wait status in the composer (#2536)', () => {
  const updateGameSessionState = vi.fn().mockResolvedValue(undefined);
  let waitChange: ((waiting: boolean) => void) | undefined;
  let engineNotice: ((notice: { text: string; persist: boolean }) => void) | undefined;
  let finishTurn: ((value: ReturnType<typeof dmReplyFromGetAIResponse>) => void) | undefined;
  let failTurn: ((error: unknown) => void) | undefined;

  /**
   * Same expression as GameMainContent: the open dice tray hides the composer line.
   * `onPlayerWaitChange(true)` is not that tray. It fires before the proposal returns.
   */
  const Composer = ({ trayOpen }: { trayOpen: boolean }): ReactElement => (
    <MessageHandler
      sessionId="session-2536"
      campaignId="campaign-2536"
      characterId="character-2536"
      turnCount={1}
      updateGameSessionState={updateGameSessionState}
    >
      {({
        handleSendMessage,
        isProcessing,
        isReconnecting,
        isStillThinking,
        attackWaitLabel,
        sendError,
        onRetry,
      }) => (
        <ChatInput
          onSendMessage={handleSendMessage}
          isDisabled={isProcessing}
          isReconnecting={isReconnecting}
          isStillThinking={isStillThinking}
          attackWaitLabel={trayOpen ? null : attackWaitLabel}
          sendError={sendError ?? undefined}
          onRetry={onRetry}
        />
      )}
    </MessageHandler>
  );

  const renderComposer = (): ReturnType<typeof render> => render(<Composer trayOpen={false} />);

  const sendAttack = async (text = ATTACK): Promise<void> => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    window.sessionStorage.clear();
    mockSendMessage.mockResolvedValue(undefined);
    mockValidateSession.mockResolvedValue(true);
    mockMessages.length = 0;
    mockGameState.diceRollQueue.currentRollId = null;
    mockGameState.diceRollQueue.pendingRolls = [];
    waitChange = undefined;
    engineNotice = undefined;
    finishTurn = undefined;
    failTurn = undefined;
    mockGetAIResponse.mockImplementation((...args: unknown[]) => {
      const signal = args[7] as { onPlayerWaitChange?: (waiting: boolean) => void };
      waitChange = signal.onPlayerWaitChange;
      engineNotice = args[6] as typeof engineNotice;
      return new Promise((resolve, reject) => {
        finishTurn = resolve;
        failTurn = reject;
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the deciding line while an attack is pending, hides it for the roll, then shows resolving until the engine line', async () => {
    const { rerender } = renderComposer();
    await sendAttack();

    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Sending message...' })).toBeDisabled();

    // waiting=true is the proposal / entry check, not the tray. The line stays.
    await act(async () => {
      waitChange?.(true);
    });
    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);

    // The dice tray is what replaces it. GameMainContent passes null while that tray is open.
    rerender(<Composer trayOpen />);
    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Sending message...' })).toBeDisabled();

    rerender(<Composer trayOpen={false} />);

    // The queue still holds this roll when the bridge settles: `requestDiceRoll` stored it, and
    // `completeDiceRoll` runs only after `settleCombatAttackRoll`. Shape is that stored request
    // (`use-player-roll-host` present() + `use-dice-roll-management` requestDiceRoll).
    mockGameState.diceRollQueue.currentRollId = 'attack-roll-1';
    mockGameState.diceRollQueue.pendingRolls = [
      {
        id: 'attack-roll-1',
        requestType: 'attack',
        description: 'Longsword attack vs Goblin — 1d20+5 vs AC 13',
        rollConfig: { dieType: 20, count: 1, modifier: 5 },
        timestamp: new Date(0),
        status: 'pending',
        combatAttackRoll: true,
      },
    ];
    await act(async () => {
      waitChange?.(false);
    });
    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(ATTACK_WAIT_RESOLVING);

    await act(async () => {
      engineNotice?.({
        text: '⚙️ Engine: You rolled 14 + 5 = 19 vs AC 13 against the goblin with Longsword — HIT. 7 slashing damage.',
        persist: true,
      });
    });
    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Sending message...' })).toBeDisabled();
  });

  it('drops the line when the turn resolves', async () => {
    renderComposer();
    await sendAttack();
    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);

    await act(async () => {
      finishTurn?.(
        dmReplyFromGetAIResponse(
          '⚙️ Engine: The goblin is out of reach, so you close in. No roll, no damage.',
        ),
      );
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sending message...' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('drops the line when the turn errors, and keeps the typed text', async () => {
    renderComposer();
    await sendAttack();
    expect(screen.getByTestId('attack-wait-status')).toBeInTheDocument();

    await act(async () => {
      failTurn?.(new Error('dm failed'));
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('drops the line when the session expires, and keeps the typed text', async () => {
    renderComposer();
    await sendAttack();
    expect(screen.getByTestId('attack-wait-status')).toBeInTheDocument();

    await act(async () => {
      failTurn?.(new SessionExpiredError());
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('drops the line when the turn aborts, and keeps the typed text', async () => {
    renderComposer();
    await sendAttack();
    expect(screen.getByTestId('attack-wait-status')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DM_TURN_TIMEOUT_MS);
    });

    expect(screen.queryByTestId('attack-wait-status')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ATTACK);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  it('returns to the deciding line when the prompt that closed was not the attack die', async () => {
    renderComposer();
    await sendAttack();
    await act(async () => {
      waitChange?.(true);
    });
    mockGameState.diceRollQueue.currentRollId = 'initiative-roll-1';
    mockGameState.diceRollQueue.pendingRolls = [
      {
        id: 'initiative-roll-1',
        requestType: 'initiative',
        description: 'Initiative for The Seeker — 1d20+2',
        rollConfig: { dieType: 20, count: 1, modifier: 2 },
        timestamp: new Date(0),
        status: 'pending',
        combatInitiativeRoll: true,
      },
    ];
    await act(async () => {
      waitChange?.(false);
    });

    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);
    expect(screen.queryByText(ATTACK_WAIT_RESOLVING)).not.toBeInTheDocument();
  });

  it('uses the neutral line for a non-attack, including a prefilter false positive', async () => {
    renderComposer();
    await sendAttack('I cast light');

    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);
    expect(
      screen.queryByText('The DM is deciding what your attack needs…'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(ATTACK_WAIT_RESOLVING)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('I cast light');
    expect(screen.getByRole('button', { name: 'Sending message...' })).toBeDisabled();
  });

  it('replaces the neutral line with the 30s still-thinking line', async () => {
    renderComposer();
    await sendAttack('I look around the room');
    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(TURN_WAIT_WORKING);

    await act(async () => {
      vi.advanceTimersByTime(DM_STILL_THINKING_TIMEOUT_MS);
    });

    expect(screen.getByText('The DM is still thinking…')).toBeInTheDocument();
    expect(screen.queryByText(TURN_WAIT_WORKING)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('I look around the room');
    expect(screen.getByRole('button', { name: 'Sending message...' })).toBeDisabled();
  });

  it('keeps Resolving your attack after the 30s mark', async () => {
    renderComposer();
    await sendAttack();
    mockGameState.diceRollQueue.currentRollId = 'attack-roll-1';
    mockGameState.diceRollQueue.pendingRolls = [
      {
        id: 'attack-roll-1',
        requestType: 'attack',
        description: 'Longsword attack vs Goblin — 1d20+5 vs AC 13',
        rollConfig: { dieType: 20, count: 1, modifier: 5 },
        timestamp: new Date(0),
        status: 'pending',
        combatAttackRoll: true,
      },
    ];
    await act(async () => {
      waitChange?.(false);
    });
    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(ATTACK_WAIT_RESOLVING);

    await act(async () => {
      vi.advanceTimersByTime(DM_STILL_THINKING_TIMEOUT_MS);
    });

    expect(screen.getByTestId('attack-wait-status')).toHaveTextContent(ATTACK_WAIT_RESOLVING);
    expect(screen.queryByText('The DM is still thinking…')).not.toBeInTheDocument();
  });
});
