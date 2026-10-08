import {
  engineRosterOf, formatCombatActionParts, formatDeathSaveParts, formatWakeParts, formatCombatEndLine,
} from './combat-outcome-transcript';
import { facingName } from './engine-display-name';

export function buildNpcEngineMessage(
  participants: Array<{ id: string; name: string; participantType: string; maxHp?: number; monsterAttack?: unknown }>,
  round: number,
  intent: { type: string; actorId: string; targetId?: string; targetIds?: string[] },
  result: unknown,
) {
  const roster = engineRosterOf(participants);
  const targetIds = intent.targetIds ?? (intent.targetId ? [intent.targetId] : []);
  const target = participants.find((participant) => participant.id === targetIds[0]);
  const parts = [
    ...formatCombatActionParts({ actor_id: intent.actorId, action_type: intent.type === 'spell' ? 'cast_spell' : intent.type, target_ids: targetIds }, result, roster,
      { targetHp: target?.participantType === 'player', targetMaxHp: target?.maxHp }),
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
  const source = participants.find((participant) => participant.id === intent.actorId)?.participantType === 'player'
    ? 'player' as const : 'npc' as const;
  return { text: lines.join('\n\n'), context: {
    intent: 'combat_npc_result', round, engineCards: cards,
    combatEngineBlocks: [{ sequence: 0, round, source, actor, lines, cards }],
  } };
}
