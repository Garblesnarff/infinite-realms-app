import {
  engineRosterOf,
  formatCombatActionParts,
  formatDeathSaveParts,
  formatWakeParts,
  formatCombatEndLine,
} from './combat-outcome-transcript';
import { facingName } from './engine-display-name';

/**
 * The plain line a player reads after the COMBAT ENDED line when the player's own action ended the
 * fight. No DM turn follows that row, so this line tells the player the turn is theirs (#1644).
 */
export const FIGHT_OVER_HINT = 'The fight is over. What do you do?';

export function buildNpcEngineMessage(
  participants: Array<{
    id: string;
    name: string;
    participantType: string;
    maxHp?: number;
    monsterAttack?: unknown;
  }>,
  round: number,
  intent: { type: string; actorId: string; targetId?: string; targetIds?: string[] },
  result: unknown,
) {
  const roster = engineRosterOf(participants);
  const targetIds = intent.targetIds ?? (intent.targetId ? [intent.targetId] : []);
  const target = participants.find((participant) => participant.id === targetIds[0]);
  const parts = [
    ...formatCombatActionParts(
      {
        actor_id: intent.actorId,
        action_type: intent.type === 'spell' ? 'cast_spell' : intent.type,
        target_ids: targetIds,
      },
      result,
      roster,
      { targetHp: target?.participantType === 'player', targetMaxHp: target?.maxHp },
    ),
    ...formatDeathSaveParts(result, roster),
    ...formatWakeParts(result),
  ];
  const lines = parts.map((part) => part.line);
  const value = result as { engineLine?: string; endedReason?: string };
  if (intent.type === 'check' && value.engineLine) lines.push(`⚙️ Engine: ${value.engineLine}`);
  const endLine = formatCombatEndLine(value.endedReason);
  if (endLine) lines.push(endLine);
  const actor = facingName(undefined, intent.actorId, roster);
  if (!lines.length) lines.push(`⚙️ Engine: ${actor} ended their turn.`);
  const cards = parts.map((part) => part.card);
  // A player's own keyed End turn is stored by the same writer; it is still the player's row.
  const source =
    participants.find((participant) => participant.id === intent.actorId)?.participantType ===
    'player'
      ? ('player' as const)
      : ('npc' as const);
  // #1644: a player's own action that ends the fight gets no DM turn, so the row names the next step.
  // A defeated party gets the death screen instead.
  if (endLine && source === 'player' && value.endedReason !== 'party_defeated') {
    lines.push(FIGHT_OVER_HINT);
  }
  return {
    text: lines.join('\n\n'),
    context: {
      intent: 'combat_npc_result',
      round,
      engineCards: cards,
      // #976: a row carrying the end line IS this fight's terminal message. Stamp it so
      // the client's deferred Combat Summary can release on the row — a server-ended
      // fight gets no DM message with the flag, and without it the card waited out
      // the 15 s fallback (or was never seen).
      ...(endLine ? { combatEnded: true } : {}),
      combatEngineBlocks: [{ sequence: 0, round, source, actor, lines, cards }],
    },
  };
}
