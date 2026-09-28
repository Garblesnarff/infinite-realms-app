import {
  VOICE_CATEGORY_VALUES,
  getCanonicalVoiceCategory,
  getVoiceConfigByCategory,
  getVoicePoolByCharacter,
  detectVoiceCategoryFromNPCType,
} from './voice/voice-classification';
import { type VoicePool, VOICE_POOLS } from './voice/voice-pools';
import { normalizeCharacterName } from './voice/voice-utils';

import type { VoiceProviderId } from './voice/voice-provider';

import { logger } from '@/lib/logger';

// Re-export utility for backward compatibility and internal use
export { normalizeCharacterName };

// Re-export from extracted modules for backward compatibility
export {
  type VoicePool,
  VOICE_POOLS,
  getCanonicalVoiceCategory,
  getVoiceConfigByCategory,
  getVoicePoolByCharacter,
  detectVoiceCategoryFromNPCType,
  VOICE_CATEGORY_VALUES,
};

// Core types for voice management
export interface VoiceSegment {
  id: string;
  type: 'dm' | 'character';
  text: string;
  character?: string;
  voiceId: string;
  voiceName: string;
  /** VOICE_CONFIGS key (narrator, goblin, ...); providers map it to their own voice. */
  voiceCategory?: string;
  /** Which provider produced audioUrl ('speech-synthesis' segments have none). */
  provider?: VoiceProviderId;
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

const UNKNOWN_SPEAKER_NAMES = new Set([
  '',
  'unknown',
  'unknown npc',
  'unknown speaker',
  'npc',
  'speaker',
  'dm',
  'narrator',
]);

export function isUnknownSpeaker(character?: string): boolean {
  return UNKNOWN_SPEAKER_NAMES.has(normalizeCharacterName(character || ''));
}

// Constants extracted from VoiceDirector
export const ELEVENLABS_MODEL = 'eleven_flash_v2_5';
export const CHARACTER_VOICE_CACHE_KEY = 'voice-director-character-mappings';

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
 * Seed the runtime map with a persistent assignment before playback starts.
 * VoiceConsistencyService is the source of the session assignment; the
 * director must reuse that assignment instead of selecting a second voice.
 */
export function setCharacterVoiceMapping(character: string, voice: VoiceConfig): void {
  const normalizedCharacter = normalizeCharacterName(character);
  if (!normalizedCharacter) {
    return;
  }

  ensureMapInitialized().set(normalizedCharacter, voice);
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
  // Narration and unknown speakers stay audible as the narrator voice.
  if (segment.type === 'dm' || isUnknownSpeaker(segment.character)) {
    return getVoiceConfigByCategory('narrator');
  }

  const character = normalizeCharacterName(segment.character || '');

  const voiceMap = ensureMapInitialized();
  const existingVoice = voiceMap.get(character);
  if (existingVoice) {
    return existingVoice;
  }

  // A category is a label, not an ElevenLabs ID. Resolve it directly so
  // aliases such as "gruff" select their configured voice instead of
  // falling through to an arbitrary pool member.
  let selectedVoice: VoiceConfig;
  let cacheable = true;
  if (segment.voice_category?.trim()) {
    selectedVoice = getVoiceConfigByCategory(segment.voice_category);
    // Do not poison the character cache with a narrator fallback for an
    // unmapped category. A later valid category must still be able to resolve.
    cacheable = Boolean(getCanonicalVoiceCategory(segment.voice_category));
  } else {
    const voicePool = getVoicePoolByCharacter(character);
    const voiceIndex = hashCharacterName(character) % voicePool.length;
    selectedVoice = voicePool[voiceIndex];
  }

  if (cacheable) {
    setCharacterVoiceMapping(character, selectedVoice);
    logger.info(
      `🎯 New voice assignment: "${character}" -> ${selectedVoice.name} [${selectedVoice.id}] (${segment.voice_category || 'auto'})`,
    );
  }

  return selectedVoice;
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
