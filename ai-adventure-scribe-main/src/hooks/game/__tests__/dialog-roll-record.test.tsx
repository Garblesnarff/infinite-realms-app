/**
 * #2614 FIX. The saved message uses the modifier in the dialog total, and a
 * check that names no ability still has a Roll button.
 */
import { render, renderHook, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  dialogFormula,
  dialogRequestFromQueue,
  queueRoll,
  sheetCharacter,
} from './dialog-roll-formula.fixture';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { useGame } from '@/contexts/GameContext';
import { useMessageDiceRolls } from '@/features/game-session/components/chat/message-list/use-message-dice-rolls';

vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(() => false),
  settleCombatCheckRoll: vi.fn(() => false),
  settleCombatInitiativeRoll: vi.fn(() => false),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  hasPendingPlayerRoll: vi.fn(() => false),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

describe('dialog roll record (#2614)', () => {
  const character = sheetCharacter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the dialog modifier on a DEX save the queue stored as +0', async () => {
    const queued = queueRoll(character, {
      type: 'save',
      formula: '1d20',
      purpose: 'Dexterity saving throw',
    });
    expect(queued.rollConfig.modifier).toBe(0);
    const onSendFullMessage = vi.fn();
    vi.mocked(useGame).mockReturnValue({
      state: { diceRollQueue: { currentRollId: queued.id, pendingRolls: [queued] } },
      getCurrentDiceRoll: vi.fn(() => queued),
      completeDiceRoll: vi.fn(),
      cancelDiceRoll: vi.fn(),
      clearBatch: vi.fn(),
    } as never);
    const { result } = renderHook(() =>
      useMessageDiceRolls({ onSendMessage: vi.fn(), onSendFullMessage }),
    );
    await act(async () => {
      await result.current.handleManualResult(17, { naturalRoll: 13 });
    });
    const [text, context] = onSendFullMessage.mock.calls[0];
    expect(context.diceRoll.modifier).toBe(4);
    expect(context.diceRoll.formula).toBe('1d20+4');
    expect(text).toContain('nat 13+4');
  });

  it('lets a loaded character roll a check that names no ability', () => {
    const queued = queueRoll(character, {
      type: 'check',
      formula: '1d20',
      purpose: 'Luck',
    });
    const request = dialogRequestFromQueue(queued);
    expect(dialogFormula(character, request)).toBe(request.formula);
    render(<DiceRollRequest request={request} onResult={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^roll /i })).toBeInTheDocument();
  });
});
