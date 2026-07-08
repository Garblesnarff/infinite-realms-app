export interface CombatDetectionResult {
  isCombat: boolean;
  combatType: 'initiative' | 'attack' | 'spell_cast' | 'damage_taken' | 'none';
  confidence: number; // 0-1
  enemies?: DetectedEnemy[];
  combatActions?: DetectedCombatAction[];
  shouldStartCombat: boolean;
  shouldEndCombat: boolean;
}

export interface DetectedEnemy {
  monsterId?: string;
  name: string;
  type: 'mech' | 'humanoid' | 'beast' | 'undead' | 'dragon' | 'construct' | 'unknown';
  estimatedCR: string;
  description: string;
  suggestedHP: number;
  suggestedAC: number;
}

export interface DetectedCombatAction {
  actor: string;
  action: string;
  target?: string;
  weapon?: string;
  damage?: string;
  rollNeeded: boolean;
  rollType: 'attack' | 'damage' | 'save' | 'skill';
}
