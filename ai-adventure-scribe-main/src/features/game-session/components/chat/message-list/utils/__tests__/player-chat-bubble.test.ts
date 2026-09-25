import { describe, expect, it } from 'vitest';

import { isOutOfCombatCheckResult, isPlayerChatBubble } from '../player-chat-bubble';

import type { ChatMessage } from '@/types/game';

const message = (partial: Partial<ChatMessage>): ChatMessage =>
  ({ sender: 'player', text: '', ...partial }) as ChatMessage;

describe('out-of-combat check results', () => {
  it('does not put a skill-check result in the player bubble', () => {
    const check = message({
      text: 'Investigation check to assess the integrity of the anchor points and rock face: 2 fail',
      context: {
        intent: 'dice_roll',
        diceRoll: { requestType: 'check', description: 'Investigation check', total: 2 },
      } as ChatMessage['context'],
    });

    expect(isOutOfCombatCheckResult(check)).toBe(true);
    expect(isPlayerChatBubble(check)).toBe(false);
  });

  it('keeps a typed player line in the player bubble', () => {
    const typed = message({ text: 'I kneel at the edge of the ledge and study the rock face.' });

    expect(isPlayerChatBubble(typed)).toBe(true);
  });

  it('recognizes a reloaded check line that lost its dice context', () => {
    const reloaded = message({
      text: 'Athletics check to climb down into the chasm: 6 fail',
    });

    expect(isPlayerChatBubble(reloaded)).toBe(false);
  });

  it('leaves combat attack and initiative results to their own engine lines', () => {
    const attack = message({
      text: 'Longsword attack: 24 hit',
      context: {
        intent: 'dice_roll',
        diceRoll: { requestType: 'attack', total: 24 },
      } as ChatMessage['context'],
    });

    expect(isOutOfCombatCheckResult(attack)).toBe(false);
    expect(isPlayerChatBubble(attack)).toBe(true);
  });
});
