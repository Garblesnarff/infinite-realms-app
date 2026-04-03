export interface NPCRequest {
  role:
    | 'shopkeeper'
    | 'guard'
    | 'noble'
    | 'commoner'
    | 'villain'
    | 'ally'
    | 'mentor'
    | 'mysterious'
    | 'authority';
  importance: 'minor' | 'major' | 'critical';
  location?: string;
  purpose?: string; // Why this NPC exists in the story
  relationship?: 'friendly' | 'neutral' | 'hostile' | 'romantic' | 'rival';
  context: {
    campaignId: string;
    sessionId?: string;
    genre: string;
    currentStory?: string;
    playerCharacterName?: string;
    locationName?: string;
    playerLevel?: number;
  };
}

export interface GeneratedNPC {
  id?: string;
  name: string;
  description: string;
  race: string;
  class?: string;
  level?: number;

  // Physical Characteristics
  gender?: 'male' | 'female';
  age?: number;
  height?: number; // in inches
  weight?: number; // in pounds
  eyes?: string;
  skin?: string;
  hair?: string;

  // Core Identity
  role: string;
  occupation: string;
  socialStatus: string;

  // Personality & Psychology
  personality: {
    traits: string[];
    ideals: string[];
    bonds: string[];
    flaws: string[];
    mannerisms: string[];
    speech: string;
  };

  // Motivations & Goals
  goals: {
    immediate: string[];
    longTerm: string[];
    secret: string[];
  };

  // Relationships & History
  background: string;
  relationships: {
    allies: string[];
    enemies: string[];
    family: string[];
    organizations: string[];
  };

  // Story Integration
  secrets: string[];
  questHooks: string[];
  narrativeRole: string;

  // Practical Details
  appearance: {
    physicalFeatures: string[];
    clothing: string;
    equipment: string[];
    distinguishingMarks: string[];
  };

  // Gameplay Mechanics
  abilities: {
    notableSkills: string[];
    combatRole?: string;
    specialAbilities: string[];
  };

  // Story Metadata
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    importance: string;
    narrativeWeight: number;
    storyArc?: string;
    locationId?: string;
  };
}
