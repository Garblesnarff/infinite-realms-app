
import { combatModifiers } from './conditions/combat-modifiers';
import { incapacitatingConditions } from './conditions/incapacitating-conditions';
import { movementModifiers } from './conditions/movement-modifiers';

import type { CombatParticipant, Condition, ConditionName } from '@/types/combat';

// ===========================
// Condition Effect Definitions
// ===========================

export interface ConditionModifiers {
  advantage: boolean;
  disadvantage: boolean;
  bonus: number;
  autoFail: boolean;
  description: string;
}

export interface ConditionDefinition {
  description: string;
  getModifiers: (
    participant: CombatParticipant,
    rollType: string,
    target?: CombatParticipant,
  ) => ConditionModifiers;
  onApply?: (participant: CombatParticipant, condition: Condition) => CombatParticipant;
  onRemove?: (participant: CombatParticipant, condition: Condition) => CombatParticipant;
  effect: string[];
}

// Core condition effects mapping
export const CONDITION_EFFECTS: Record<ConditionName, ConditionDefinition> = {
  ...(combatModifiers as Record<ConditionName, ConditionDefinition>),
  ...(incapacitatingConditions as Record<ConditionName, ConditionDefinition>),
  ...(movementModifiers as Record<ConditionName, ConditionDefinition>),
};
export type { ConditionDefinition as ConditionDefinitionType };
