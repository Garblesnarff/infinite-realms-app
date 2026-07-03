/**
 * Maps combat action types to their extracted handlers.
 */

import {
  handleSpellCast,
  handleDivineSmite,
  handleRageActivation,
  handleRageDeactivation,
  handleShortRest,
  handleLongRest,
  handleHideAction,
} from './action-handlers';

import type { ActionHandlerResult } from './action-handlers';
import type { CombatAction as CombatActionType, CombatParticipant } from '@/types/combat';

export type ActionDispatchEntry = (
  action: Partial<CombatActionType>,
  participant: CombatParticipant,
) => ActionHandlerResult | undefined;

export const actionDispatchTable: Record<string, ActionDispatchEntry> = {
  cast_spell: (action, participant) =>
    participant.participantType === 'player' ? handleSpellCast(action, participant) : undefined,
  divine_smite: (action, participant) => handleDivineSmite(action, participant),
  use_class_feature: (action, participant) =>
    action.featureUsed === 'rage' ? handleRageActivation(action, participant) : undefined,
  end_rage: (_action, participant) => handleRageDeactivation(participant),
  short_rest: (_action, participant) => handleShortRest(participant, 1),
  long_rest: (_action, participant) => handleLongRest(participant),
  hide: (_action, participant) => handleHideAction(participant),
};
