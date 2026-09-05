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

import logger from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';
import { userDataApi } from '@/services/user-data-api';
import {
  parseOptionalProficiencyList,
  parseSavingThrowProficiencies,
} from '@/utils/character/parse-proficiency-list';

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
  _userId?: string,
): Promise<Character | undefined> {
  try {
    // The authenticated server route performs the ownership check. game_sessions has no user_id column.
    const session = await userDataApi.getSession(sessionId);

    if (!session?.character_id) return undefined;

    const [characterData, equipmentData] = await Promise.all([
      userDataApi.getCharacter(session.character_id),
      issue1784Api.getCharacterEquipment(session.character_id),
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
      // See load-character-with-spells.ts — the proficiency columns carry the
      // proficiency bonus for skills and saves (issue #1827).
      skillProficiencies: parseOptionalProficiencyList(characterData.skill_proficiencies),
      expertiseProficiencies: parseOptionalProficiencyList(characterData.expertise_proficiencies),
      toolProficiencies: parseOptionalProficiencyList(characterData.tool_proficiencies),
      savingThrowProficiencies: parseSavingThrowProficiencies(
        characterData.saving_throw_proficiencies,
      ),
      languages: parseOptionalProficiencyList(characterData.languages),
      personalityTraits: [],
      ideals: [],
      bonds: [],
      flaws: [],
      equipment: equipmentData.map((item: { item_name: string }) => item.item_name),
    };
  } catch (error) {
    logger.error('[CharacterLoader] Error loading character by session:', error);
    return undefined;
  }
}
