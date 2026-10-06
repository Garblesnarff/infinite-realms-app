import type { ChatMessage as ServiceChatMessage } from '@/services/ai/shared/types';
import type { ChatMessage } from '@/types/game';

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
    narrationSegments: msg.narrationSegments,
    speakerType: msg.sender,
    speakerName: msg.speakerName ?? msg.characterName,
  }));
}
