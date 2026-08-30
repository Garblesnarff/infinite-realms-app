/**
 * Renders persisted chat messages into the `<conversation_history>` prompt block.
 */
import type { ChatMessage } from './types';

import { extractNarrativeContent, parseMessageOptions } from '@/utils/parseMessageOptions';

/**
 * Strip a DM turn's action-option menu before it is replayed as history (#1944).
 *
 * Every DM message is persisted with its lettered menu appended (see
 * `use-ai-response`), so feeding history back verbatim showed the model the exact
 * block it was about to write — and it answered a state-changing turn by
 * re-emitting the previous menu's leftovers, renumbered. The player's *chosen*
 * action still reaches the model: it is a separate `Player:` line. Only the
 * offered-but-unchosen menu is dropped, so there is nothing stale to copy.
 *
 * Uses the same parser the UI renders buttons from, so what is stripped here is
 * exactly what the player saw as options — the two cannot drift apart.
 */
export function stripOfferedOptions(content: string): string {
  try {
    if (!parseMessageOptions(content).hasOptions) return content;
    return extractNarrativeContent(content) || content;
  } catch {
    return content;
  }
}

/**
 * Keep the prompt's speaker labels aligned with the persisted speaker type.
 * Companion speech is already explicitly marked as in-world user text, so it
 * must never fall through to the DM label used by legacy two-speaker history.
 */
export function formatConversationHistoryMessage(message: ChatMessage): string {
  const speakerType = message.speakerType ?? (message.role === 'user' ? 'player' : 'dm');
  if (speakerType === 'companion') {
    const name = message.speakerName || 'Unknown';
    const prefix = `Companion ${name} (in-world speech): `;
    return message.content.startsWith(prefix) ? message.content : `${prefix}${message.content}`;
  }

  const label = speakerType === 'player' ? 'Player' : speakerType === 'system' ? 'System' : 'DM';
  const content = speakerType === 'dm' ? stripOfferedOptions(message.content) : message.content;
  return `${label}: ${content}`;
}
