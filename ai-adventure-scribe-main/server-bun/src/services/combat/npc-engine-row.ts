import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { applyFightOverHint } from './fight-over-hint.js';
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
  kind: 'npc' | 'player';
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

export function writeNpcEngineRow(
  state: CombatState,
  intent: { type: string; actorId: string; targetId?: string; targetIds?: string[] },
  actionId: string,
  result: unknown,
  userId: string,
  origin?: string,
): Promise<NpcEngineRow[]> {
  const built = buildNpcEngineMessage(
    state.participants,
    state.encounter.currentRound,
    intent,
    result,
  );
  // #1644: only an action-bar kill has no DM turn after it; the hint goes on that row alone.
  const message = applyFightOverHint(
    built,
    origin,
    (result as { endedReason?: string | null } | null)?.endedReason,
  );
  return storeEngineRow(
    state,
    actionId,
    message.text,
    { ...message.context, npcResult: result },
    userId,
    message.context.combatEngineBlocks[0].source,
  );
}

/** One engine line in the combat log, keyed by `actionId` so a replayed drain writes it once. */
export function writeEngineLineRow(
  state: CombatState,
  actionId: string,
  line: string,
  userId: string,
): Promise<NpcEngineRow[]> {
  const round = state.encounter.currentRound;
  return storeEngineRow(
    state,
    actionId,
    line,
    {
      intent: 'combat_npc_result',
      round,
      combatEngineBlocks: [{ sequence: 0, round, source: 'npc', lines: [line], cards: [] }],
    },
    userId,
  );
}

/** Player movement is written by the route from the path the engine actually applied. */
export function writePlayerMoveRow(
  state: CombatState,
  actionId: string,
  line: string,
  userId: string,
): Promise<NpcEngineRow[]> {
  const round = state.encounter.currentRound;
  return storeEngineRow(
    state,
    actionId,
    line,
    {
      intent: 'combat_player_result',
      round,
      combatEngineBlocks: [
        {
          sequence: 0,
          round,
          source: 'player',
          lines: [line],
          cards: [{ kind: 'move', side: 'party', title: line, line }],
        },
      ],
    },
    userId,
    'player',
  );
}

/** The safety-cap line, one row per (round, holder): a drain that stops there again writes nothing. */
export function writeNpcCapRow(
  state: CombatState,
  line: string,
  userId: string,
): Promise<NpcEngineRow[]> {
  const round = state.encounter.currentRound;
  return storeEngineRow(
    state,
    `cap:${round}:${state.currentParticipant?.id ?? 'none'}`,
    line,
    {
      intent: 'combat_npc_result',
      round,
      combatEngineBlocks: [{ sequence: 0, round, source: 'npc', lines: [line], cards: [] }],
    },
    userId,
  );
}

async function storeEngineRow(
  state: CombatState,
  actionId: string,
  text: string,
  context: Record<string, unknown>,
  userId: string,
  kind: NpcEngineRow['kind'] = 'npc',
): Promise<NpcEngineRow[]> {
  const stored = await SessionMessageService.addMessages(
    [
      {
        id: messageId(state.encounter.id, actionId),
        sessionId: state.encounter.sessionId,
        speakerType: 'system',
        message: text,
        context: { ...context, combatEncounterId: state.encounter.id, actionId },
      },
    ],
    userId,
  );
  const rows: NpcEngineRow[] = stored.map((row) => ({
    id: row.id,
    sequence: row.sequenceNumber,
    text: row.message,
    kind,
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
