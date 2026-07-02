/**
 * loadCharacterBySession implementation, split out of character-loader.ts.
 */

import { buildAbilityScores } from './build-ability-scores';

import type {
  Character,
  CharacterRace,
  CharacterClass,
  CharacterBackground,
} from '@/types/character';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Load character details by game session ID.
 * Resolves the character_id from the session, then loads the character with equipment.
 *
 * @param sessionId - The game session ID
 * @param userId - Optional user ID for ownership validation (SECURITY: strongly recommended)
 * @returns Character object or undefined if not found
 */
export async function loadCharacterBySession(
  sessionId: string,
  userId?: string,
): Promise<Character | undefined> {
  try {
    // Build session query with ownership validation if userId provided
    let sessionQuery = supabase
      .from('game_sessions')
      .select('character_id, user_id')
      .eq('id', sessionId);

    // SECURITY: Validate session ownership if userId provided
    if (userId) {
      sessionQuery = sessionQuery.eq('user_id', userId);
    }

    const { data: session } = await sessionQuery.single();

    if (!session?.character_id) return undefined;

    // Build character query with ownership validation if userId provided
    let characterQuery = supabase
      .from('characters')
      .select(
        `
        *,
        character_stats (*),
        character_equipment (*)
      `,
      )
      .eq('id', session.character_id);

    // SECURITY: Validate character ownership if userId provided
    if (userId) {
      characterQuery = characterQuery.eq('user_id', userId);
    }

    const { data: characterData } = await characterQuery.single();

    if (!characterData) return undefined;

    const characterRace = characterData.race
      ? ({ name: characterData.race } as Partial<CharacterRace>)
      : null;
    const characterClass = characterData.class
      ? ({ name: characterData.class } as Partial<CharacterClass>)
      : null;
    const characterBackground = characterData.background
      ? ({ name: characterData.background } as Partial<CharacterBackground>)
      : null;

    return {
      id: characterData.id,
      user_id: characterData.user_id,
      name: characterData.name,
      race: characterRace as CharacterRace | null,
      class: characterClass as CharacterClass | null,
      level: characterData.level,
      background: characterBackground as CharacterBackground | null,
      description: characterData.description,
      abilityScores: characterData.character_stats?.[0]
        ? buildAbilityScores({
            strength: characterData.character_stats[0].strength,
            dexterity: characterData.character_stats[0].dexterity,
            constitution: characterData.character_stats[0].constitution,
            intelligence: characterData.character_stats[0].intelligence,
            wisdom: characterData.character_stats[0].wisdom,
            charisma: characterData.character_stats[0].charisma,
          })
        : undefined,
      experience: characterData.experience_points || 0,
      alignment: characterData.alignment || '',
      personalityTraits: [],
      ideals: [],
      bonds: [],
      flaws: [],
      equipment:
        characterData.character_equipment?.map((item: { item_name: string }) => item.item_name) ||
        [],
    };
  } catch (error) {
    logger.error('[CharacterLoader] Error loading character by session:', error);
    return undefined;
  }
}
