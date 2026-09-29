import type { ChatMessage } from '@/types/game';

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
function engineLinesOfMessage(message: ChatMessage): string[] {
  const blocks = combatEngineBlocksFromContext(message.context);
  if (blocks.length) return blocks.flatMap((block) => block.lines);
  const { lines } = extractEngineGeneratedLines(removeRollRequestsFromMessage(message.text ?? ''));
  return lines;
}

/**
 * The lines the combat tracker log shows: the engine lines the chat shows, latest first, at most
 * `limit`. A DM reply held back behind its roll is not on screen in chat, so its lines are not
 * here either.
 */
export function combatLogLines(
  messages: readonly ChatMessage[],
  limit: number = COMBAT_LOG_LIMIT,
): string[] {
  const withheld = withheldDmRollReplies(messages);
  return messages
    .filter((message) => message.sender === 'dm' && !withheld.has(message))
    .flatMap(engineLinesOfMessage)
    .slice(-limit)
    .reverse();
}
