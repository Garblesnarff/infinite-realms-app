import { GridType } from '@/types/scene';

export interface SceneTemplate {
  id: string;
  name: string;
  description: string;
  category: 'interior' | 'exterior' | 'dungeon' | 'wilderness' | 'urban';
  width: number;
  height: number;
  gridSize: number;
  gridType: GridType;
  thumbnailEmoji: string;
  suggestedSettings: {
    enableFogOfWar: boolean;
    enableDynamicLighting: boolean;
    ambientLightLevel: string;
    timeOfDay: string;
  };
}

export const BUILT_IN_TEMPLATES: SceneTemplate[] = [
  {
    id: 'tavern',
    name: 'Tavern Interior',
    description: 'Cozy tavern with tables, bar, and fireplace',
    category: 'interior',
    width: 20,
    height: 15,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🍺',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: true,
      ambientLightLevel: '0.70',
      timeOfDay: 'night',
    },
  },
  {
    id: 'forest',
    name: 'Forest Clearing',
    description: 'Open area surrounded by dense trees',
    category: 'wilderness',
    width: 30,
    height: 25,
    gridSize: 5,
    gridType: GridType.HEXAGONAL_VERTICAL,
    thumbnailEmoji: '🌲',
    suggestedSettings: {
      enableFogOfWar: true,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
  {
    id: 'dungeon-corridor',
    name: 'Dungeon Corridor',
    description: 'Stone corridors with multiple rooms',
    category: 'dungeon',
    width: 25,
    height: 20,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🏛️',
    suggestedSettings: {
      enableFogOfWar: true,
      enableDynamicLighting: true,
      ambientLightLevel: '0.20',
      timeOfDay: 'night',
    },
  },
  {
    id: 'castle-throne',
    name: 'Castle Throne Room',
    description: 'Grand hall with throne and pillars',
    category: 'interior',
    width: 30,
    height: 20,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '👑',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: true,
      ambientLightLevel: '0.80',
      timeOfDay: 'day',
    },
  },
  {
    id: 'cave',
    name: 'Natural Cave',
    description: 'Winding cave system with stalagmites',
    category: 'dungeon',
    width: 25,
    height: 25,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '⛰️',
    suggestedSettings: {
      enableFogOfWar: true,
      enableDynamicLighting: true,
      ambientLightLevel: '0.00',
      timeOfDay: 'night',
    },
  },
  {
    id: 'town-square',
    name: 'Town Square',
    description: 'Open plaza with fountain and market stalls',
    category: 'urban',
    width: 25,
    height: 25,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🏛️',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
  {
    id: 'ship-deck',
    name: 'Ship Deck',
    description: 'Upper deck of a sailing vessel',
    category: 'exterior',
    width: 30,
    height: 15,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '⛵',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
  {
    id: 'arena',
    name: 'Combat Arena',
    description: 'Circular arena with tiered seating',
    category: 'urban',
    width: 30,
    height: 30,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '⚔️',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
  {
    id: 'mountain-path',
    name: 'Mountain Path',
    description: 'Narrow trail along a cliff face',
    category: 'wilderness',
    width: 20,
    height: 30,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🏔️',
    suggestedSettings: {
      enableFogOfWar: true,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
  {
    id: 'wizard-tower',
    name: 'Wizard Tower',
    description: 'Circular tower interior with arcane symbols',
    category: 'interior',
    width: 20,
    height: 20,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🔮',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: true,
      ambientLightLevel: '0.60',
      timeOfDay: 'night',
    },
  },
  {
    id: 'graveyard',
    name: 'Graveyard',
    description: 'Cemetery with tombstones and crypts',
    category: 'exterior',
    width: 25,
    height: 20,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '⚰️',
    suggestedSettings: {
      enableFogOfWar: true,
      enableDynamicLighting: true,
      ambientLightLevel: '0.40',
      timeOfDay: 'night',
    },
  },
  {
    id: 'bridge',
    name: 'Stone Bridge',
    description: 'Bridge crossing over a ravine or river',
    category: 'exterior',
    width: 15,
    height: 25,
    gridSize: 5,
    gridType: GridType.SQUARE,
    thumbnailEmoji: '🌉',
    suggestedSettings: {
      enableFogOfWar: false,
      enableDynamicLighting: false,
      ambientLightLevel: '1.00',
      timeOfDay: 'day',
    },
  },
];
