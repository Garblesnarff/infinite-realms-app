export interface RollRequest {
  type: 'attack' | 'save' | 'check' | 'damage' | 'damage_taken' | 'initiative' | 'skill_check';
  formula: string; // "1d20+5" or "1d20+modifier" or "1d20+str"
  purpose: string; // "Arcana check to understand the mechanism"
  dc?: number; // Target DC if applicable
  ac?: number; // Target AC for attacks
  advantage?: boolean;
  disadvantage?: boolean;
  modifier?: number; // Base modifier if not in formula
  // NEW: Flag for auto-executing NPC rolls (DM rolling "behind the screen")
  autoExecute?: boolean;
  actorName?: string; // Name of who's rolling (e.g., "Goblin Archer", "Orc Warrior")
  // Target for damage_taken rolls
  target?: string; // "player" or NPC name
  damageType?: string; // fire, cold, etc.
}
