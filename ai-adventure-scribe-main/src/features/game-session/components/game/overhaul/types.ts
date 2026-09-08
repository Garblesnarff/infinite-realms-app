/**
 * View-model types for the navy+gold game-session overhaul UI.
 *
 * These describe the *presentation* shape consumed by the overhaul panels.
 * A separate mapper (see useOverhaulViewModel) adapts the live game contexts
 * (campaign / character / combat / session) into this shape, so the panels
 * stay pure and previewable with mock data.
 */

export interface AbilityScoreVM {
  label: string; // STR, DEX, ...
  score: number; // 16
  modifier: string; // "+3"
}

export interface NamedModVM {
  label: string; // "Athletics" / "STR"
  modifier: string; // "+5"
}

export interface PartyMemberVM {
  id: string;
  name: string;
  subtitle: string; // "Level 5 Cleric"
  currentHp: number | null;
  maxHp: number | null;
  avatarUrl?: string;
}

export interface CombatantVM {
  id: string;
  initiative: number; // 18
  name: string;
  isEnemy?: boolean;
  isActive?: boolean;
}

export interface AttackVM {
  id: string;
  name: string; // "Longsword"
  bonus: string; // "+6"
  damage: string; // "1d8+3"
}

export interface ConditionVM {
  id: string;
  name: string; // "Bless"
  duration?: string; // "1m"
  iconUrl?: string;
}

export interface EquipmentVM {
  id: string;
  name: string; // "Longsword"
  detail: string; // "+6 to hit, 1d8+3 slashing"
}

export interface InventoryItemVM {
  id: string;
  name: string; // "Potion of Healing"
  quantity?: number; // 3
}

export interface CharacterSheetVM {
  name: string; // "Aldric Vale"
  subtitle: string; // "Human · Fighter (Champion)"
  level: number;
  xpCurrent: number;
  xpMax: number;
  avatarUrl?: string;
  hpCurrent: number | null;
  hpMax: number | null;
  ac: number;
  initiative: string; // "+3"
  speed: number; // 30
  abilityScores: AbilityScoreVM[];
  savingThrows: NamedModVM[];
  skills: NamedModVM[];
  attacks: AttackVM[];
  conditions: ConditionVM[];
  equipment: EquipmentVM[];
  inventory: InventoryItemVM[];
  gold?: number;
  carriedWeight?: number;
  maxWeight?: number;
}

export interface ObjectiveTaskVM {
  id: string;
  label: string;
  done?: boolean;
}

export interface CampaignSummaryVM {
  name: string; // "Shadows of Eryndor"
  chapter: string; // "Chapter 2: Whispers in the Fog"
  thumbnailUrl?: string;
  objective: string;
  objectiveTasks: ObjectiveTaskVM[];
  regionMapUrl?: string;
  regionLabel?: string; // "Mistwood"
}

/** Everything the overhaul side-rails need. */
export interface GameOverhaulViewModel {
  campaign: CampaignSummaryVM;
  party: PartyMemberVM[];
  partyMax: number;
  combat: {
    active: boolean;
    round: number;
    combatants: CombatantVM[];
  };
  character: CharacterSheetVM;
  scene: {
    title: string; // "THE OLD WATCHTOWER"
    blurb: string; // "A mist-cloaked ruin stirs with ancient presence."
  };
}
