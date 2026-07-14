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
import { userDataApi } from '@/services/user-data-api';

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
    // The authenticated server route performs the ownership check. game_sessions has no user_id column.
    const session = await userDataApi.getSession(sessionId);

    if (!session?.character_id) return undefined;

    const [characterData, equipmentResult] = await Promise.all([
      userDataApi.getCharacter(session.character_id),
      supabase
        .from('character_equipment')
        .select('item_name')
        .eq('character_id', session.character_id),
    ]);

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
      equipment: equipmentResult.data?.map((item: { item_name: string }) => item.item_name) || [],
    };
  } catch (error) {
    logger.error('[CharacterLoader] Error loading character by session:', error);
    return undefined;
  }
}
