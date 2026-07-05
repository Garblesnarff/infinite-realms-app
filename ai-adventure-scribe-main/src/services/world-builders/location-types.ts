export interface LocationRequest {
  type: 'settlement' | 'dungeon' | 'wilderness' | 'landmark' | 'building' | 'room';
  size?: 'tiny' | 'small' | 'medium' | 'large' | 'massive';
  purpose?: string; // What the location is for
  atmosphere?: 'peaceful' | 'mysterious' | 'dangerous' | 'sacred' | 'corrupt' | 'bustling';
  connectedTo?: string; // Location ID this connects to
  context: {
    campaignId: string;
    sessionId?: string;
    genre: string;
    currentStory?: string;
    nearbyLocations?: string[];
    playerLevel?: number;
  };
}

export interface GeneratedLocation {
  id?: string;
  name: string;
  description: string;
  type: string;
  atmosphere: string;
  sizeCategory: string;
  keyFeatures: string[];
  inhabitants: string[];
  threats: string[];
  treasures: string[];
  secrets: string[];
  connections: string[];
  lore: string;
  narrativeHooks: string[];
  sensoryDetails: {
    sights: string[];
    sounds: string[];
    smells: string[];
    atmosphere: string;
  };
  mechanics: {
    skillChallenges: string[];
    hiddenElements: string[];
    interactiveFeatures: string[];
  };
  metadata: {
    createdAt: Date;
    campaignId: string;
    sessionId?: string;
    narrativeWeight: number;
    storyArc?: string;
  };
}
