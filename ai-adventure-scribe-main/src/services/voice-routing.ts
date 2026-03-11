import logger from '@/lib/logger';

// Core types for voice management
export interface VoiceSegment {
  id: string;
  type: 'dm' | 'character';
  text: string;
  character?: string;
  voiceId: string;
  voiceName: string;
  voiceSettings: {
    stability: number;
    similarity_boost: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
  audioUrl?: string;
  audioBlob?: Blob;
  isGenerating?: boolean;
  isPlaying?: boolean;
  error?: string;
}

export interface VoicePool {
  dm: VoiceConfig[];
  heroes: VoiceConfig[];
  npcs: VoiceConfig[];
  villains: VoiceConfig[];
  creatures: VoiceConfig[];
}

export interface VoiceConfig {
  id: string;
  name: string;
  description: string;
  settings: {
    stability: number;
    similarity_boost: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

export interface AISegment {
  type: 'dm' | 'character';
  text: string;
  character?: string;
  voice_category?: string;
}

// Constants extracted from VoiceDirector
export const ELEVENLABS_MODEL = 'eleven_turbo_v2_5';
export const CHARACTER_VOICE_CACHE_KEY = 'voice-director-character-mappings';

// Simplified voice pools - fewer options, clearer choices
export const VOICE_POOLS: VoicePool = {
  dm: [
    {
      id: 'T0GKiSwCb51L7pv1sshd', // Same voice ID as old AudioPlayer
      name: 'DM Voice',
      description: 'Main DM narrator voice (old compatible)',
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    },
  ],

  heroes: [
    {
      id: 'GBv7mTt0atIp3Br8iCZE', // Thomas
      name: 'Thomas',
      description: 'Noble male hero voice',
      settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    },
    {
      id: 'BlgEcC0TfWpBak7FmvHW', // Fena
      name: 'Fena',
      description: 'Young female hero voice',
      settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.3,
        use_speaker_boost: true,
      },
    },
  ],

  npcs: [
    {
      id: 'pMsXgVXv3BLzUgSXRplE', // Serena
      name: 'Serena',
      description: 'Warm innkeeper voice',
      settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    },
    {
      id: 'g2W4HAjKvdW93AmsjsOx', // Nathan
      name: 'Nathan',
      description: 'Friendly merchant voice',
      settings: {
        stability: 0.4,
        similarity_boost: 0.8,
        style: 0.4,
        use_speaker_boost: true,
      },
    },
    {
      id: 'yoZ06aMxZJJ28mfd3POQ', // Sam
      name: 'Sam',
      description: 'Wise elder voice',
      settings: {
        stability: 0.8,
        similarity_boost: 0.8,
        style: 0.1,
        use_speaker_boost: true,
      },
    },
  ],

  villains: [
    {
      id: '2gPFXx8pN3Avh27Dw5Ma', // Oxley
      name: 'Oxley',
      description: 'Ominous male villain voice',
      settings: {
        stability: 0.7,
        similarity_boost: 0.9,
        style: 0.4,
        use_speaker_boost: true,
      },
    },
    {
      id: 'flHkNRp1BlvT73UL6gyz', // Jessica Anne Bogart
      name: 'Jessica Anne Bogart',
      description: 'Wickedly eloquent female villain voice',
      settings: {
        stability: 0.8,
        similarity_boost: 0.85,
        style: 0.5,
        use_speaker_boost: true,
      },
    },
  ],

  creatures: [
    {
      id: 'cPoqAvGWCPfCfyPMwe4z', // Kallixis
      name: 'Kallixis',
      description: 'Deep ancient malevolence voice',
      settings: {
        stability: 0.9,
        similarity_boost: 0.7,
        style: 0.1,
        use_speaker_boost: false,
      },
    },
    {
      id: 'dfZGXKiIzjizWtJ0NgPy', // Michael Mouse
      name: 'Michael Mouse',
      description: 'High-pitched comic character for goblins',
      settings: {
        stability: 0.3,
        similarity_boost: 0.6,
        style: 0.6,
        use_speaker_boost: true,
      },
    },
  ],
};

// Character voice assignments (persistent state)
let characterVoiceMap: Map<string, VoiceConfig> | null = null;

/**
 * Ensure the characterVoiceMap is initialized
 */
export function ensureMapInitialized(): Map<string, VoiceConfig> {
  if (!characterVoiceMap) {
    characterVoiceMap = new Map<string, VoiceConfig>();
  }
  return characterVoiceMap;
}

/**
 * Clear character voice mappings
 */
export function clearCharacterVoiceMappings(): void {
  const voiceMap = ensureMapInitialized();
  voiceMap.clear();
}

/**
 * Get current character-to-voice mappings
 */
export function getCharacterVoiceMappings(): Record<string, string> {
  const mappings: Record<string, string> = {};
  const voiceMap = ensureMapInitialized();
  voiceMap.forEach((voice, character) => {
    mappings[character] = voice.name;
  });
  return mappings;
}

/**
 * Assign voice to a segment based on character and type
 */
export function assignVoice(segment: AISegment): VoiceConfig {
  // DM/Narrator always gets the DM voice
  if (segment.type === 'dm') {
    return VOICE_POOLS.dm[0];
  }

  // Character voices
  if (segment.character) {
    const character = normalizeCharacterName(segment.character);

    // Check if we've assigned a voice to this character before
    const voiceMap = ensureMapInitialized();
    const existingVoice = voiceMap.get(character);
    if (existingVoice) {
      return existingVoice;
    }

    // Assign new voice based on voice category hint or character fingerprint
    let voicePool: VoiceConfig[];

    if (segment.voice_category) {
      voicePool = getVoicePoolByCategory(segment.voice_category);
    } else {
      voicePool = getVoicePoolByCharacter(character);
    }

    // Use character name hash to pick consistent voice from pool
    const voiceIndex = hashCharacterName(character) % voicePool.length;
    const selectedVoice = voicePool[voiceIndex];

    // Remember this assignment
    voiceMap.set(character, selectedVoice);

    logger.info(
      `🎯 New voice assignment: "${character}" -> ${selectedVoice.name} (${segment.voice_category || 'auto'})`,
    );
    return selectedVoice;
  }

  // Fallback to DM voice
  return VOICE_POOLS.dm[0];
}

/**
 * Get voice pool based on AI's voice category hint
 */
export function getVoicePoolByCategory(category: string): VoiceConfig[] {
  const categoryMap: Record<string, keyof VoicePool> = {
    narrator: 'dm',
    hero_male: 'heroes',
    hero_female: 'heroes',
    hero: 'heroes',
    villain_male: 'villains',
    villain_female: 'villains',
    villain: 'villains',
    monster: 'creatures',
    creature: 'creatures',
    goblin: 'creatures',
    merchant: 'npcs',
    guard: 'npcs',
    innkeeper: 'npcs',
    elder: 'npcs',
    child: 'npcs',
  };

  const poolKey = categoryMap[category.toLowerCase()] || 'npcs';
  return VOICE_POOLS[poolKey];
}

/**
 * Get voice pool based on character name patterns
 */
export function getVoicePoolByCharacter(character: string): VoiceConfig[] {
  const lowerChar = character.toLowerCase();

  // Villain keywords
  if (
    lowerChar.includes('villain') ||
    lowerChar.includes('evil') ||
    lowerChar.includes('dark') ||
    lowerChar.includes('necromancer') ||
    lowerChar.includes('cultist') ||
    lowerChar.includes('bandit')
  ) {
    return VOICE_POOLS.villains;
  }

  // Creature keywords
  if (
    lowerChar.includes('dragon') ||
    lowerChar.includes('monster') ||
    lowerChar.includes('goblin') ||
    lowerChar.includes('orc') ||
    lowerChar.includes('troll') ||
    lowerChar.includes('beast')
  ) {
    return VOICE_POOLS.creatures;
  }

  // Hero keywords
  if (
    lowerChar.includes('hero') ||
    lowerChar.includes('champion') ||
    lowerChar.includes('knight') ||
    lowerChar.includes('paladin')
  ) {
    return VOICE_POOLS.heroes;
  }

  // Default to NPCs for most characters
  return VOICE_POOLS.npcs;
}

/**
 * Create a consistent hash from character name for voice assignment
 */
export function hashCharacterName(character: string): number {
  let hash = 0;
  for (let i = 0; i < character.length; i++) {
    const char = character.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Normalize character names for consistent voice assignment
 */
export function normalizeCharacterName(character: string): string {
  return character
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an)\s+/i, '') // Remove articles
    .replace(/[^\w\s'-]/g, '') // Remove special characters except apostrophes and hyphens
    .replace(/\s+/g, ' ') // Normalize spaces
    .trim();
}

/**
 * Detect voice category from NPC type keywords
 * Maps common D&D NPC types to voice categories
 */
export function detectVoiceCategoryFromNPCType(character: string): string | undefined {
  const lowerChar = character.toLowerCase();

  // Creature/Monster types -> creature voice (Check first as they may have other keywords like 'ancient')
  if (/goblin|orc|troll|ogre|beast|creature|monster|dragon|demon|spirit|ghost/.test(lowerChar)) {
    return 'creature';
  }

  // Guard/Military types -> gruff voice
  if (/guard|soldier|captain|knight|warrior|mercenary|watchman|watch/.test(lowerChar)) {
    return 'guard';
  }

  // Merchant/Trader types -> friendly voice
  if (/merchant|trader|shopkeep|vendor|salesman|peddler/.test(lowerChar)) {
    return 'merchant';
  }

  // Innkeeper/Hospitality types -> warm voice
  if (/innkeeper|barkeep|bartender|tavern|host|barmaid/.test(lowerChar)) {
    return 'innkeeper';
  }

  // Wizard/Mage types -> mysterious/elderly voice
  if (/wizard|mage|sorcerer|warlock|witch|sage|scholar|oracle|mystic|archmage/.test(lowerChar)) {
    return 'elder';
  }

  // Noble/Royalty types -> refined voice
  if (
    /noble|lord|lady|duke|duchess|baron|count|prince|princess|king|queen|aristocrat/.test(lowerChar)
  ) {
    return 'hero'; // Using hero pool for refined voices
  }

  // Elder/Wise types -> wise elder voice
  if (/elder|old|ancient|wise|priest|cleric|monk|hermit/.test(lowerChar)) {
    return 'elder';
  }

  // Child types -> (use NPC pool for now, could add child voices later)
  if (/child|boy|girl|kid|young|urchin/.test(lowerChar)) {
    return 'merchant'; // Friendly voice for children
  }

  // Villain types -> villain voice
  if (/villain|evil|dark|necromancer|cultist|bandit|thief|assassin|rogue/.test(lowerChar)) {
    return 'villain';
  }

  // Default: no specific category, will use NPC pool
  return undefined;
}
