import type { VoiceConfig } from './voice-types';

/**
 * ElevenLabs Flash v2.5 model - cheapest at 0.5 credits per character
 */
export const MODEL_ID = 'eleven_flash_v2_5';

/**
 * Available voice configurations
 */
export const VOICE_CONFIGS: Record<string, VoiceConfig> = {
  // Main Narrator - Default DM voice
  narrator: {
    id: 'T0GKiSwCb51L7pv1sshd', // DM Voice - shared with VoiceDirector's DM pool
    name: 'Will',
    description: 'Main DM narrator voice',
    model: MODEL_ID,
    category: 'narrator',
    settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.1,
      use_speaker_boost: true,
    },
  },

  // Heroes and Good Characters
  hero_male: {
    id: 'GBv7mTt0atIp3Br8iCZE', // Thomas - premade voice
    name: 'Thomas',
    description: 'Noble male hero voice',
    model: MODEL_ID,
    category: 'hero',
    settings: {
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
    },
  },

  hero_female: {
    id: 'BlgEcC0TfWpBak7FmvHW', // Fena - Young sassy girl character
    name: 'Fena',
    description: 'Young female hero voice',
    model: MODEL_ID,
    category: 'hero',
    settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.3,
      use_speaker_boost: true,
    },
  },

  // Villains and Evil Characters
  villain_male: {
    id: '2gPFXx8pN3Avh27Dw5Ma', // Oxley - Evil Character
    name: 'Oxley',
    description: 'Ominous male villain voice',
    model: MODEL_ID,
    category: 'villain',
    settings: {
      stability: 0.7,
      similarity_boost: 0.9,
      style: 0.4,
      use_speaker_boost: true,
    },
  },

  villain_female: {
    id: 'flHkNRp1BlvT73UL6gyz', // Jessica Anne Bogart - Character and Animation
    name: 'Jessica Anne Bogart',
    description: 'Wickedly eloquent female villain voice',
    model: MODEL_ID,
    category: 'villain',
    settings: {
      stability: 0.8,
      similarity_boost: 0.85,
      style: 0.5,
      use_speaker_boost: true,
    },
  },

  // Creatures and Monsters
  monster: {
    id: 'cPoqAvGWCPfCfyPMwe4z', // Kallixis - Monster & Deep
    name: 'Kallixis',
    description: 'Deep ancient malevolence voice',
    model: MODEL_ID,
    category: 'creature',
    settings: {
      stability: 0.9,
      similarity_boost: 0.7,
      style: 0.1,
      use_speaker_boost: false,
    },
  },

  goblin: {
    id: 'dfZGXKiIzjizWtJ0NgPy', // Michael Mouse - High Energy Comic Character
    name: 'Michael Mouse',
    description: 'High-pitched comic character for goblins',
    model: MODEL_ID,
    category: 'creature',
    settings: {
      stability: 0.3,
      similarity_boost: 0.6,
      style: 0.6,
      use_speaker_boost: true,
    },
  },

  // NPCs
  guard: {
    id: 'GBv7mTt0atIp3Br8iCZE', // Thomas - reused for authority figures
    name: 'Thomas',
    description: 'Authoritative guard voice',
    model: MODEL_ID,
    category: 'npc',
    settings: {
      stability: 0.8,
      similarity_boost: 0.7,
      style: 0.1,
      use_speaker_boost: true,
    },
  },

  merchant: {
    id: 'g2W4HAjKvdW93AmsjsOx', // Nathan - Funny Cartoon Character
    name: 'Nathan',
    description: 'Friendly merchant voice',
    model: MODEL_ID,
    category: 'npc',
    settings: {
      stability: 0.4,
      similarity_boost: 0.8,
      style: 0.4,
      use_speaker_boost: true,
    },
  },

  innkeeper: {
    id: 'pMsXgVXv3BLzUgSXRplE', // Serena - premade voice
    name: 'Serena',
    description: 'Warm innkeeper voice',
    model: MODEL_ID,
    category: 'npc',
    settings: {
      stability: 0.6,
      similarity_boost: 0.8,
      style: 0.2,
      use_speaker_boost: true,
    },
  },

  // Children
  child: {
    id: 'ha06sua2KFh5KIb2atMC', // Silly Billy - Cartoon Character
    name: 'Silly Billy',
    description: 'Light & cute cartoon voice for children',
    model: MODEL_ID,
    category: 'child',
    settings: {
      stability: 0.3,
      similarity_boost: 0.7,
      style: 0.5,
      use_speaker_boost: true,
    },
  },

  // Elders and Wise Characters
  elder: {
    id: 'yoZ06aMxZJJ28mfd3POQ', // Sam - premade voice
    name: 'Sam',
    description: 'Wise elder voice',
    model: MODEL_ID,
    category: 'elder',
    settings: {
      stability: 0.8,
      similarity_boost: 0.8,
      style: 0.1,
      use_speaker_boost: true,
    },
  },

  // Default fallback
  default: {
    id: 'T0GKiSwCb51L7pv1sshd', // Same as narrator and VoiceDirector's DM pool
    name: 'Will',
    description: 'Default voice for unknown characters',
    model: MODEL_ID,
    category: 'npc',
    settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.1,
      use_speaker_boost: true,
    },
  },
};

/**
 * Character type keywords for automatic mapping
 */
export const CHARACTER_KEYWORDS = {
  villain: [
    'villain',
    'evil',
    'dark lord',
    'necromancer',
    'demon',
    'devil',
    'cultist',
    'bandit leader',
    'witch',
    'warlock',
  ],
  monster: [
    'dragon',
    'demon',
    'ancient',
    'beast',
    'lich',
    'vampire lord',
    'giant',
    'titan',
    'elemental',
  ],
  goblin: ['goblin', 'imp', 'sprite', 'fairy', 'pixie', 'gnome', 'halfling', 'kobold'],
  guard: ['guard', 'soldier', 'captain', 'sergeant', 'knight', 'paladin', 'sheriff', 'watchman'],
  merchant: ['merchant', 'trader', 'shopkeeper', 'vendor', 'peddler', 'salesman', 'fence'],
  innkeeper: ['innkeeper', 'barkeep', 'bartender', 'tavern keeper', 'proprietor', 'host'],
  child: ['child', 'kid', 'boy', 'girl', 'young', 'orphan', 'student', 'apprentice'],
  elder: [
    'elder',
    'sage',
    'wizard',
    'priest',
    'hermit',
    'scholar',
    'old man',
    'old woman',
    'grandmother',
    'grandfather',
    'thorne',
  ],
  hero_male: ['hero', 'champion', 'warrior', 'fighter', 'ranger', 'rogue', 'bard'],
  hero_female: [
    'heroine',
    'warrior woman',
    'ranger woman',
    'female fighter',
    'sorceress',
    'priestess',
  ],
};
