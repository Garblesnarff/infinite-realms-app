import { buildNpcEngineMessage } from '../npc-engine-message';

/** Same pure producer called by writeNpcEngineRow; keeps the tests on the server wire shape. */
export function receivedNpcMessages(batch: unknown, participants: Array<{ id: string; name: string; participantType: string }>) {
  const value = batch as { results?: Array<{ round: number; action: { actor_id: string; action_type: string; target_ids: string[] }; engineResult: unknown }> };
  return (value?.results ?? []).map((result) => ({ sender: 'system' as const,
    ...buildNpcEngineMessage(participants, result.round, {
      type: result.action.action_type, actorId: result.action.actor_id, targetIds: result.action.target_ids,
    }, result.engineResult),
  }));
}
