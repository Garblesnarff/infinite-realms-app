import type { ChatMessage } from '@/types/game';

import { hideTargetNumbers, isEngineResultCard } from '@/services/combat/engine-result-card';
import { combatEngineBlocksFromContext } from '@/utils/combat-engine-blocks';
import { withheldDmRollReplies } from '@/utils/dm-roll-recovery';
import { extractEngineGeneratedLines } from '@/utils/engine-lines';
import { removeRollRequestsFromMessage } from '@/utils/rollRequestParser';

/** The tracker log keeps the newest twenty engine lines. */
export const COMBAT_LOG_LIMIT = 20;

/**
 * Engine lines one DM message shows in chat, oldest first. Same rule as `DMMessage`: structured
 * combat blocks win, and the `⚙️ Engine:` lines in the text are only read when there are none.
 */
function engineLinesOfMessage(message: ChatMessage, showTargetNumbers: boolean): string[] {
  // With the setting off a line loses the target's AC and the save DC where a card says which
  // phrases they are; a line saved before cards existed has no card and keeps its text.
  const hide = (lines: string[], cards: unknown): string[] =>
    showTargetNumbers || !Array.isArray(cards)
      ? lines
      : lines.map((line) =>
          cards
            .filter(isEngineResultCard)
            .reduce((text, card) => hideTargetNumbers(text, card), line),
        );
  const blocks = combatEngineBlocksFromContext(message.context);
  if (blocks.length) return blocks.flatMap((block) => hide(block.lines, block.cards));
  const { lines } = extractEngineGeneratedLines(removeRollRequestsFromMessage(message.text ?? ''));
  return hide(lines, message.context?.engineCards);
}

/**
 * The lines the combat tracker log shows: the engine lines the chat shows, latest first, at most
 * `limit`. A DM reply held back behind its roll is not on screen in chat, so its lines are not
 * here either. Engine lines shown ahead of the reply arrive as system rows (#2378, #2386).
 */
export function combatLogLines(
  messages: readonly ChatMessage[],
  limit: number = COMBAT_LOG_LIMIT,
  showTargetNumbers = true,
  currentEncounterId?: string,
): string[] {
  const withheld = withheldDmRollReplies(messages);
  return messages
    .filter((message) => {
      const taggedEncounterId = message.context?.combatEncounterId;
      // Only lines tagged to a different encounter are dropped. Untagged
      // lines (restored history, the seating card, engine notices that do
      // not go through scopedEngineNotice) belong to the live encounter:
      // every producer tags its lines, so an untagged line is legacy, not
      // another encounter's.
      if (
        currentEncounterId &&
        taggedEncounterId &&
        taggedEncounterId !== currentEncounterId
      )
        return false;
      return message.sender === 'system' || (message.sender === 'dm' && !withheld.has(message));
    })
    .flatMap((message) => engineLinesOfMessage(message, showTargetNumbers))
    .slice(-limit)
    .reverse();
}
