export interface RollRequest {
  rollRequestId?: string;
  type: 'attack' | 'save' | 'check' | 'damage' | 'damage_taken' | 'initiative' | 'skill_check';
  formula: string; // "1d20+5" or "1d20+modifier" or "1d20+str"
  purpose: string; // "Arcana check to understand the mechanism"
  dc?: number; // Target DC if applicable
  ac?: number; // Target AC for attacks
  /** #1086 (e): the part of `ac` that is cover, so the dialog shows 'AC 12 +2 half cover'. */
  coverBonus?: number;
  advantage?: boolean;
  disadvantage?: boolean;
  modifier?: number; // Base modifier if not in formula
  // The engine proposed this roll and adds its own bonus to the die; the dialog must not recompute it
  engineOwned?: boolean;
  // NEW: Flag for auto-executing NPC rolls (DM rolling "behind the screen")
  autoExecute?: boolean;
  actorName?: string; // Name of who's rolling (e.g., "Goblin Archer", "Orc Warrior")
  // Target for damage_taken rolls
  target?: string; // "player" or NPC name
  damageType?: string; // fire, cold, etc.
}
