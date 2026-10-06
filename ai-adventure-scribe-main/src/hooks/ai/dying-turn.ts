import type { AIResponse } from '@/services/ai-service';
import type { CombatParticipant } from '@/types/combat';

import { participantVital } from '@/services/combat/participant-vital';

/** What the player reads when something other than the death save is sent for a downed character. */
export const DYING_ACTION_REFUSED_NOTICE =
  'Your character is unconscious and dying, so they cannot act. Death saving throws are rolled on your turn.';

/**
 * The turn result for a dying player's turn while the DM has not been called: the one action the
 * engine accepts from a character on the floor, and no prose. With no participant on the floor
 * (the fight ended in the pre-flight, say) there is nothing to declare.
 */
export function dyingTurnDeclaration(player: CombatParticipant | undefined): AIResponse {
  const dying = player && participantVital(player) === 'dying';
  return {
    text: '',
    combat_transition: 'none',
    roll_requests: [],
    combat_actions: dying
      ? [
          {
            actor_id: player.id,
            action_type: 'death_save',
            target_ids: [],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
        ]
      : [],
    map_actions: [],
    handout_actions: [],
  } as unknown as AIResponse;
}
