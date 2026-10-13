/**
 * #310: a deterministic engine line in chat.
 *
 * XP awards — combat victories and story wins — must be visible in chat, not just on the
 * sheet, and not only when the DM remembers to narrate them. This is the same real chat
 * path the NPC engine rows use (`storeEngineRow` in combat/npc-engine-row.ts): a persisted
 * `system` message in dialogue_history, broadcast to the room so a live session sees it
 * without a refresh. The client merges broadcast `engineRows` into the message list as
 * system messages (use-messages.ts).
 *
 * Throws on failure: callers that must not lose the notice (`ensureCombatVictoryXpNotice`,
 * `ensureStoryXpNotice`) catch, log, and retry on the next award call. The id is a
 * deterministic sha256→uuid seed (dialogue_history.id is a uuid; the same pattern as
 * npc-engine-row's messageId); `addMessages` inserts with onConflictDoNothing on the id,
 * so a retried write posts the line once.
 */
import { createHash } from 'node:crypto';

import { broadcastToRoom } from './collaboration/room-manager.js';
import { SessionMessageService } from './session/session-message-service.js';

/** Deterministic uuid for an engine line, so retries of the same notice are a no-op. */
export function engineLineUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface EngineChatLineInput {
  sessionId: string;
  userId: string;
  /** Deterministic seed — hashed to the row id. */
  idSeed: string;
  text: string;
  context: Record<string, unknown>;
}

/** Injectable seam for the fail-first notice tests: a transient write failure. */
export type EngineChatLineWriter = (input: EngineChatLineInput) => Promise<void>;

export async function postEngineChatLine(input: EngineChatLineInput): Promise<void> {
  const { sessionId, userId, idSeed, text, context } = input;
  const stored = await SessionMessageService.addMessages(
    [{ id: engineLineUuid(idSeed), sessionId, speakerType: 'system', message: text, context }],
    userId,
  );
  if (!stored.length) return;
  broadcastToRoom(sessionId, null as never, {
    type: 'chat',
    sessionId,
    engineRows: stored.map((row) => ({
      id: row.id,
      sequence: row.sequenceNumber,
      text: row.message,
      kind: 'system',
      sessionId,
      timestamp: row.timestamp!.toISOString(),
      context: row.context,
    })),
  });
}

/** True when the notice row is already persisted (a retry must not rewrite it). */
export async function engineChatLineExists(idSeed: string): Promise<boolean> {
  const { db } = await import('../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { dialogueHistory } = await import('../../../db/schema/index');
  const [row] = await db
    .select({ id: dialogueHistory.id })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.id, engineLineUuid(idSeed)))
    .limit(1);
  return !!row;
}
