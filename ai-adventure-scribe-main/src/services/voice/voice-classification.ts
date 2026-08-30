import { VOICE_CONFIGS } from './voice-constants';
import { type VoicePool, VOICE_POOLS } from './voice-pools';

import type { VoiceConfig } from '../voice-routing';
import type { VoiceConfig as VoiceDefinition } from './voice-types';

import logger from '@/lib/logger';

const VOICE_CATEGORY_ALIASES: Record<string, string> = {
  dm: 'narrator',
  narrator: 'narrator',
  hero: 'hero_male',
  villain: 'villain_male',
  creature: 'monster',
  gruff: 'guard',
};

const VOICE_CATEGORY_POOLS: Record<string, keyof VoicePool> = {
  narrator: 'dm',
  hero_male: 'heroes',
  hero_female: 'heroes',
  villain_male: 'villains',
  villain_female: 'villains',
  monster: 'creatures',
  goblin: 'creatures',
  merchant: 'npcs',
  guard: 'npcs',
  innkeeper: 'npcs',
  elder: 'npcs',
  child: 'npcs',
  default: 'npcs',
};

/**
 * Normalize the category labels emitted by the AI before looking them up.
 * Category labels are not ElevenLabs voice IDs; they must resolve to a
 * configured voice before they reach the audio service.
 */
export function normalizeVoiceCategory(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/**
 * Return the configured category key for an AI category label.
 */
export function getCanonicalVoiceCategory(category: string): string | undefined {
  if (typeof category !== 'string' || !category.trim()) {
    return undefined;
  }

  const normalized = normalizeVoiceCategory(category);
  const canonical = VOICE_CATEGORY_ALIASES[normalized] || normalized;
  return VOICE_CONFIGS[canonical] ? canonical : undefined;
}

/**
 * Resolve a category to a real ElevenLabs voice configuration.
 * Unknown categories deliberately warn instead of silently becoming narrator.
 */
export function getVoiceConfigByCategory(category: string): VoiceDefinition {
  const canonical = getCanonicalVoiceCategory(category);
  if (canonical) {
    return VOICE_CONFIGS[canonical];
  }

  logger.warn(
    `⚠️ Unmapped voice category "${String(category)}"; falling back to narrator voice (${VOICE_CONFIGS.narrator.id})`,
  );
  return VOICE_CONFIGS.narrator;
}

/**
 * Get voice pool based on AI's voice category hint
 */
export function getVoicePoolByCategory(category: string): VoiceConfig[] {
  const canonical = getCanonicalVoiceCategory(category);
  const poolKey = canonical ? VOICE_CATEGORY_POOLS[canonical] : undefined;
  if (!poolKey) {
    getVoiceConfigByCategory(category);
    return VOICE_POOLS.dm;
  }

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
  if (/guard|soldier|captain|knight|warrior|mercenary|\bwatch(?:man)?\b/.test(lowerChar)) {
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
