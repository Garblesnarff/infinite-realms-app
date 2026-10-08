import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { dialogueHistory } from '../../../../db/schema/index';
import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';
import { broadcastToRoom } from '../collaboration/room-manager.js';
import { SessionMessageService } from '../session/session-message-service.js';

import type { CombatState } from '../../types/combat.js';

export type NpcEngineRow = {
  id: string;
  sequence: number | null;
  text: string;
  kind: 'npc';
  actionId: string;
  sessionId: string;
  timestamp: string;
  context: unknown;
};

const messageId = (encounterId: string, actionId: string) => {
  const hex = createHash('sha256').update(`${encounterId}:npc:${actionId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

export async function readNpcEngineResult(
  encounterId: string,
  actionId: string,
  sessionId: string,
) {
  const [stored] = await db
    .select()
    .from(dialogueHistory)
    .where(
      and(
        eq(dialogueHistory.id, messageId(encounterId, actionId)),
        eq(dialogueHistory.sessionId, sessionId),
      ),
    );
  return (stored?.context as { npcResult?: Record<string, unknown> } | null)?.npcResult;
}

export async function writeNpcEngineRow(
  state: CombatState,
  intent: { type: string; actorId: string; targetId?: string; targetIds?: string[] },
  actionId: string,
  result: unknown,
  userId: string,
): Promise<NpcEngineRow[]> {
  const message = buildNpcEngineMessage(state.participants, state.encounter.currentRound, intent, result);
  const stored = await SessionMessageService.addMessages(
    [
      {
        id: messageId(state.encounter.id, actionId),
        sessionId: state.encounter.sessionId,
        speakerType: 'system',
        message: message.text,
        context: {
          ...message.context,
          combatEncounterId: state.encounter.id,
          actionId,
          npcResult: result,
        },
      },
    ],
    userId,
  );
  const rows: NpcEngineRow[] = stored.map((row) => ({
    id: row.id,
    sequence: row.sequenceNumber,
    text: row.message,
    kind: 'npc',
    actionId,
    sessionId: state.encounter.sessionId,
    timestamp: row.timestamp!.toISOString(),
    context: row.context,
  }));
  if (rows.length)
    broadcastToRoom(state.encounter.sessionId, null as never, {
      type: 'chat',
      sessionId: state.encounter.sessionId,
      engineRows: rows,
    });
  return rows;
}
