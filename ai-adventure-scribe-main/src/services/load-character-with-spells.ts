/**
 * loadCharacterWithSpells implementation, split out of character-loader.ts.
 */

import { buildAbilityScores } from './build-ability-scores';
import { characterSpellService } from './characterSpellApi';
import { hydrateCharacterStats } from './hydrate-character-stats';
import { loadGrantedClassIdentity } from './load-granted-class-identity';

import type { CharacterSpellData } from './characterSpellApi';
import type { Character, CharacterClass, CharacterBackground } from '@/types/character';

import logger from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';
import { userDataApi } from '@/services/user-data-api';
import { parseJsonField, resolveRace, resolveSubrace } from '@/utils/character/data-transformers';
import { equipmentRowsToInventory } from '@/utils/character/equipment-rows-to-inventory';
import {
  parseOptionalProficiencyList,
  parseSavingThrowProficiencies,
} from '@/utils/character/parse-proficiency-list';
import { parseSpellSlots } from '@/utils/character/spell-slots';
import { convertSpellIdsToFrontend } from '@/utils/spell-id-mapping';

/**
 * Load a complete character with all spell data populated
 * @param characterId - Character ID to load
 * @param userId - Optional user ID for ownership validation (SECURITY: strongly recommended)
 * @returns Complete character object with spell arrays populated
 */
export async function loadCharacterWithSpells(
  characterId: string,
  userId?: string,
): Promise<Character | null> {
  try {
    logger.info(`🔄 [CharacterLoader] Loading character ${characterId} with spells`);

    void userId;
    // Equipment is what the sheet's attacks, equipment and inventory sections are built from
    // (#2531). It is supplementary to the character record, so a failed request leaves
    // `inventory` unset rather than failing the game load.
    const [characterData, equipmentRows] = await Promise.all([
      userDataApi.getCharacter(characterId),
      issue1784Api.getCharacterEquipment(characterId).catch((error: unknown) => {
        logger.warn('[CharacterLoader] Character equipment request failed', {
          characterId,
          error,
        });
        return null;
      }),
    ]);

    if (!characterData) {
      logger.error('[CharacterLoader] Character not found or access denied');
      return null;
    }

    // Transform basic character data
    const stats = Array.isArray(characterData.character_stats)
      ? characterData.character_stats[0]
      : characterData.character_stats;

    // #757: resolve the full race/subrace record from the data tables. Building a
    // name-only race here dropped `speed`, so the game panel's derivation fell back
    // to the default 30 while the standalone sheet (which resolves the record) showed
    // the race's real speed.
    const characterRace = resolveRace(characterData.race);
    const characterSubrace = resolveSubrace(characterRace, characterData.subrace);
    const characterClass = characterData.class
      ? ({ name: characterData.class } as Partial<CharacterClass>)
      : null;
    const characterBackground = characterData.background
      ? ({ name: characterData.background } as Partial<CharacterBackground>)
      : null;

    // Parse spell data from the characters table first (primary source)
    let cantrips: string[] = [];
    let knownSpells: string[] = [];
    let preparedSpells: string[] = [];
    let ritualSpells: string[] = [];

    // Parse spell data from database fields - handles comma-separated TEXT format
    const parseSpellString = (spellString: string | null): string[] => {
      if (!spellString || spellString.trim() === '') return [];
      return spellString
        .split(',')
        .map((spell) => spell.trim())
        .filter((spell) => spell.length > 0);
    };

    logger.info(`📖 [CharacterLoader] Loading spells from characters table for ${characterId}`);
    cantrips = parseSpellString(characterData.cantrips);
    knownSpells = parseSpellString(characterData.known_spells);
    preparedSpells = parseSpellString(characterData.prepared_spells); // Now exists in database
    ritualSpells = parseSpellString(characterData.ritual_spells); // Now exists in database

    logger.debug(`📊 [CharacterLoader] Parsed spells from characters table:`, {
      cantrips: cantrips.length,
      knownSpells: knownSpells.length,
      preparedSpells: preparedSpells.length,
      ritualSpells: ritualSpells.length,
      rawCantrips: characterData.cantrips,
      rawKnownSpells: characterData.known_spells,
    });

    // Optional enhancement: Try to load additional spell data from API
    try {
      logger.info(`🔍 [CharacterLoader] Attempting to enhance with API data...`);
      const spellData = await characterSpellService.getCharacterSpells(characterId);

      if (spellData && (spellData.cantrips.length > 0 || spellData.spells.length > 0)) {
        logger.info(`🎯 [CharacterLoader] Found API spell data:`, {
          apiCantrips: spellData.cantrips.length,
          apiSpells: spellData.spells.length,
        });

        // Normalize API spell identifiers to frontend kebab-case IDs. Current
        // responses use canonical slugs in `id`; legacy records may use UUIDs
        // or either of the older field aliases.
        const getApiSpellId = (spell: CharacterSpellData): string | undefined =>
          spell.id ||
          (spell as CharacterSpellData & { spell_id?: string }).spell_id ||
          (spell as CharacterSpellData & { spellId?: string }).spellId;
        const cantripIds = spellData.cantrips
          .map(getApiSpellId)
          .filter((id): id is string => Boolean(id));
        const spellIds = spellData.spells
          .map(getApiSpellId)
          .filter((id): id is string => Boolean(id));

        const apiCantrips = convertSpellIdsToFrontend(cantripIds);
        const apiKnownSpells = convertSpellIdsToFrontend(spellIds);

        // Merge API data with database data (prefer API data if available)
        if (apiCantrips.length > 0) {
          logger.info(`🔄 [CharacterLoader] Using API cantrips instead of database cantrips`);
          cantrips = apiCantrips;
        }
        if (apiKnownSpells.length > 0) {
          logger.info(`🔄 [CharacterLoader] Using API spells instead of database spells`);
          knownSpells = apiKnownSpells;
          // Update prepared spells if we got new known spells
          if (preparedSpells.length === 0) {
            preparedSpells = [...knownSpells];
          }
        }

        logger.info(`✅ [CharacterLoader] Enhanced with API data:`, {
          finalCantrips: cantrips.length,
          finalKnownSpells: knownSpells.length,
          finalPreparedSpells: preparedSpells.length,
        });
      } else {
        logger.info(`📝 [CharacterLoader] No API spell data found, using database data`);
      }
    } catch (spellError) {
      logger.warn(`⚠️ [CharacterLoader] API enhancement failed, using database data:`, spellError);
      // Continue with database spell data - this is not a fatal error
    }

    // #1019: subclass and granted features live in their own tables. The
    // character GET does not carry them, so the sheet read them here.
    const classIdentity = await loadGrantedClassIdentity(
      characterId,
      typeof characterData.class === 'string' ? characterData.class : null,
    );

    // #824: the session sheet's attack list reads fightingStyles off this object. The
    // record's styles were never carried here, so a ranged weapon showed +5 on the sheet
    // while the roll — which reads the DB row — used +7. Same normalization as
    // transformCharacterData: a JSON string parses, an array passes through, and strings
    // fold to the canonical lowercase snake spelling ('Archery' -> 'archery') that the
    // FIGHTING_STYLES lookup is keyed by.
    const fightingStylesRaw =
      typeof characterData.fighting_styles === 'string'
        ? parseJsonField<unknown>(characterData.fighting_styles, [])
        : characterData.fighting_styles;
    const fightingStyles = Array.isArray(fightingStylesRaw)
      ? fightingStylesRaw
          .filter((style): style is string => typeof style === 'string')
          .map((style) => style.toLowerCase().replace(/\s+/g, '_'))
      : [];

    // Construct complete character object
    const loadedCharacter: Character = {
      id: characterData.id,
      user_id: characterData.user_id || '',
      name: characterData.name,
      race: characterRace,
      subrace: characterSubrace,
      class: characterClass as CharacterClass | null,
      ...(classIdentity.subclassName ? { subclassName: classIdentity.subclassName } : {}),
      ...(classIdentity.grantedFeatureNames
        ? { grantedFeatureNames: classIdentity.grantedFeatureNames }
        : {}),
      ...(fightingStyles.length > 0 ? { fightingStyles } : {}),
      level: characterData.level || 1,
      background: characterBackground as CharacterBackground | null,
      // The server stores and seats this AC value; do not recompute it from
      // ability scores after the character API has already supplied it.
      armorClass: stats?.armor_class ?? undefined,
      // The stat bar reads stored HP from character_stats. Dropping the row
      // here left a premade on "—" for the whole session (#2235).
      character_stats: hydrateCharacterStats(stats),
      abilityScores: buildAbilityScores({
        strength: stats?.strength || 10,
        dexterity: stats?.dexterity || 10,
        constitution: stats?.constitution || 10,
        intelligence: stats?.intelligence || 10,
        wisdom: stats?.wisdom || 10,
        charisma: stats?.charisma || 10,
      }),
      experience: characterData.experience_points || 0,
      alignment: characterData.alignment || '',
      description: characterData.description || '',
      // Proficiencies drive the proficiency bonus on every skill check and
      // saving throw. Without them the sheet reports raw ability modifiers
      // (issue #1827).
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
      equipment: [],
      ...(equipmentRows ? { inventory: equipmentRowsToInventory(equipmentRows) } : {}),
      // Character images
      avatar_url: characterData.avatar_url,
      image_url: characterData.image_url,
      background_image: characterData.background_image,
      // Spell data - this is the key fix!
      cantrips,
      knownSpells,
      preparedSpells,
      ritualSpells,
      spellSlots: parseSpellSlots(characterData.spell_slots),
      // #751 follow-up: the GET payload already carries the sheet's hitDice
      // aggregate (normalizeCharacter folds the server's hit_dice rows, which
      // are the rows RestService spends from). Dropping it here starved the
      // sheet's Hit Dice counters and the rest prompt's dice count on every
      // load and every engine-event refresh — the displays existed but never
      // had data in game.
      ...(characterData.hitDice ? { hitDice: characterData.hitDice } : {}),
    };

    logger.info(`🎯 [CharacterLoader] Successfully loaded character with spells:`, {
      name: loadedCharacter.name,
      id: loadedCharacter.id,
      cantrips: loadedCharacter.cantrips?.length || 0,
      knownSpells: loadedCharacter.knownSpells?.length || 0,
    });

    return loadedCharacter;
  } catch (error) {
    logger.error('[CharacterLoader] Error loading character with spells:', error);
    return null;
  }
}
