import type {
  CombatState,
  CombatEncounter,
  CombatParticipant,
  CombatAction as CombatActionType,
  ReactionOpportunity,
  ActionType,
} from '@/types/combat';
import type { StateCreator } from 'zustand';


export interface TurnManagementActions {
  nextTurn: () => void;
  rollInitiative: (participantId: string) => number;
  rerollInitiative: (participantId: string, newInitiative: number) => void;
  updateInitiativeOrder: (newOrder: string[]) => void;
  setGroupId: (participantId: string, groupId: string) => void;
}

export interface ParticipantManagementActions {
  addParticipant: (participant: CombatParticipant) => void;
  removeParticipant: (participantId: string) => void;
  updateParticipant: (participantId: string, updates: Partial<CombatParticipant>) => void;
}

export interface CombatManagementActions {
  setEncounter: (encounter: CombatEncounter) => void;
  startCombat: () => void;
  endCombat: () => void;
}

export interface ActionManagementActions {
  addAction: (action: CombatActionType) => void;
}

export interface SelectionActions {
  setSelectedParticipant: (participantId?: string) => void;
  setSelectedTarget: (targetId?: string) => void;
}

export interface UIToggleActions {
  toggleInitiativeTracker: () => void;
  toggleCombatLog: () => void;
}

export interface ReactionManagementActions {
  addReactionOpportunity: (opportunity: ReactionOpportunity) => void;
  removeReactionOpportunity: (opportunityId: string) => void;
  clearReactionOpportunities: () => void;
  setPendingReaction: (opportunityId: string, selectedReaction: ActionType) => void;
}

export interface CombatStore extends
  CombatState,
  CombatManagementActions,
  TurnManagementActions,
  ParticipantManagementActions,
  ActionManagementActions,
  SelectionActions,
  UIToggleActions,
  ReactionManagementActions {}

export type CombatSlice<T> = StateCreator<
  CombatStore,
  [['zustand/devtools', never]],
  [],
  T
>;
