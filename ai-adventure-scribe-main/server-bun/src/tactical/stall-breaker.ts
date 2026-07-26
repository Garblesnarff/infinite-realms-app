/**
 * The stall-breaker: when three turns pass with nothing resolving, the DM is told so directly.
 *
 * Run 9's transcript ends with the model emitting seq 20 byte-for-byte identical to seq 12.
 * That is not a creativity failure, it is a closed loop with no input: the board never moved,
 * `<engine_resolved_outcomes>` never carried a line, and the model had literally nothing new to
 * condition on, so it reproduced its own last stable output. Every other layer in this wave
 * makes attacks easier to declare; this one makes the silence itself visible to the model.
 *
 * It fires on the third consecutive silent turn and keeps firing while the silence lasts,
 * because a directive that appears once during an ongoing stall is a directive the next turn's
 * context has already forgotten.
 */
import { entitySlug, resolveEntityRef } from './identity.js';

import type { TacticalMap } from './types.js';

/** Three turns of nothing is a stall; one or two is a scene with talking in it. */
export const STALL_TURN_THRESHOLD = 3;

export function shouldBreakStall(silentTurns: number): boolean {
  return silentTurns >= STALL_TURN_THRESHOLD;
}

/**
 * The directive, carrying this turn's live tokens rather than placeholders — the same reasoning
 * that made the legacy hint quote real slugs. A model told to write `<actor_id>` has to decode
 * the instruction before it can obey it; one shown `shadow-roach-1` can copy it.
 *
 * Every token here is `entitySlug`, never the raw id. On a slugged board the ids are uuids, and
 * a directive that ordered the DM to copy uuids into `roll_requests` was handing it strings it
 * had never been shown — the surrounding digest speaks only slugs — so the one turn meant to
 * break the stall emitted references nothing downstream could resolve. The lookup goes through
 * `resolveEntityRef` for the same reason: the caller passes whichever form the turn loop holds.
 */
export function buildStallDirective(
  map: TacticalMap,
  activeEntityId: string | undefined,
  silentTurns: number,
): string {
  const active =
    (activeEntityId ? resolveEntityRef(map.entities, activeEntityId) : null) ??
    map.entities.find((entity) => entity.type === 'pc');
  const actorId = active ? entitySlug(active) : (activeEntityId ?? 'unknown');
  // Objects are on the board too; only the other side of the fight is a legal target.
  const opposing = (active?.type ?? 'pc') === 'pc' ? 'monster' : 'pc';
  const target = map.entities.find(
    (entity) => entity.id !== active?.id && entity.type === opposing,
  );
  const targetId = target ? entitySlug(target) : 'unknown';
  const roster = map.entities
    .filter((entity) => entity.type !== 'object')
    .map((entity) => entitySlug(entity))
    .join(', ');
  return `<combat_directive>
The engine has resolved NOTHING for ${silentTurns} consecutive turns. No attack you narrated in that
time reached it, so no creature has taken a point of damage and the board has not moved. Whatever
you have been writing, it is not being read as an action.

Fix it on THIS turn. It is ${actorId}'s turn. Declare its attack in the \`roll_requests\` array,
copying ids from this exact list: ${roster}

"roll_requests": [{"type":"attack","formula":"1d20","purpose":"${actorId} attacks ${targetId}","dc":null,"ac":null,"advantage":false,"disadvantage":false}]

Do not narrate a hit, a miss, or any damage number this turn - the engine will roll it and tell you
what happened next turn. Do not repeat the paragraph you wrote last turn. Do not explain this
instruction to the player.
</combat_directive>`;
}
