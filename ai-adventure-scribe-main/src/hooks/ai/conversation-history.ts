import type {
  ChatMessage as ServiceChatMessage,
  NarrationSegment as ServiceNarrationSegment,
} from '@/services/ai/shared/types';
import type { ChatMessage } from '@/types/game';

type GameNarrationSegment = NonNullable<ChatMessage['narrationSegments']>[number];

/**
 * The DM schema emits only `dm` / `character` / `transition` segments, while the game
 * type still carries the legacy `action` / `dialogue` / `narration` / `thought` kinds
 * that never occur at runtime (#458). Map those onto the service vocabulary so the
 * history matches the wire shape; real segments pass through untouched.
 */
function toServiceSegmentType(type: GameNarrationSegment['type']): ServiceNarrationSegment['type'] {
  switch (type) {
    case 'character':
    case 'dialogue':
      return 'character';
    case 'transition':
      return 'transition';
    case 'dm':
    case 'narration':
    case 'action':
    case 'thought':
    default:
      return 'dm';
  }
}

function toServiceSegments(
  segments: ChatMessage['narrationSegments'],
): ServiceNarrationSegment[] | undefined {
  if (!segments) return undefined;
  return segments.map((segment) => ({ ...segment, type: toServiceSegmentType(segment.type) }));
}

/**
 * The transcript as the DM prompt's `<conversation_history>` receives it. Every row goes in,
 * with its sender as `speakerType`, so a system line (a declined roll, #2291) reads as
 * "System: …" rather than as something the DM said.
 */
export function conversationHistoryFrom(messages: readonly ChatMessage[]): ServiceChatMessage[] {
  return messages.map((msg) => ({
    id: `msg_${Date.now()}_${Math.random()}`,
    role:
      msg.sender === 'player' || msg.sender === 'companion'
        ? ('user' as const)
        : ('assistant' as const),
    content:
      msg.sender === 'companion'
        ? `Companion ${msg.speakerName ?? msg.characterName ?? 'Unknown'} (in-world speech): ${msg.text}`
        : msg.text,
    // #2609: carry the source timestamp, not "now". The roll-outcome staleness
    // bound compares the outcome's roll_result entry against the latest DM
    // reply; stamping every entry with the conversion time would make every
    // reply look newer than any roll.
    timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
    narrationSegments: toServiceSegments(msg.narrationSegments),
    speakerType: msg.sender,
    speakerName: msg.speakerName ?? msg.characterName,
  }));
}
