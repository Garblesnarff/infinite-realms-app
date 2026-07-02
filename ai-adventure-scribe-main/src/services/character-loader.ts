/**
 * Character Loading Service
 *
 * Loads complete character data including spells from database
 * and transforms it into the proper format for the frontend
 *
 * @author AI Dungeon Master Team
 */

import { loadCharacterBySession } from './load-character-by-session';
import { loadCharacterWithSpells } from './load-character-with-spells';

import type { Character } from '@/types/character';

export class CharacterLoaderService {
  /**
   * Load a complete character with all spell data populated
   * @param characterId - Character ID to load
   * @param userId - Optional user ID for ownership validation (SECURITY: strongly recommended)
   * @returns Complete character object with spell arrays populated
   */
  async loadCharacterWithSpells(characterId: string, userId?: string): Promise<Character | null> {
    return loadCharacterWithSpells(characterId, userId);
  }

  /**
   * Load character details by game session ID.
   * Resolves the character_id from the session, then loads the character with equipment.
   *
   * @param sessionId - The game session ID
   * @param userId - Optional user ID for ownership validation (SECURITY: strongly recommended)
   * @returns Character object or undefined if not found
   */
  async loadCharacterBySession(sessionId: string, userId?: string): Promise<Character | undefined> {
    return loadCharacterBySession(sessionId, userId);
  }
}

// Export singleton instance
export const characterLoaderService = new CharacterLoaderService();
