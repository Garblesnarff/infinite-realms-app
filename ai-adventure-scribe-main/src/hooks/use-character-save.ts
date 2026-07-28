// SDK Imports
import { useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';

// Project Imports
import { logger } from '../lib/logger';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case
import { supabase } from '@/integrations/supabase/client';
import { characterBackgroundGenerator } from '@/services/character-background-generator';
import { characterSpellService } from '@/services/characterSpellApi';
import { userDataApi } from '@/services/user-data-api';
import { transformCharacterForStorage } from '@/types/character';
import {
  transformAbilityScoresForStorage,
  transformEquipmentForStorage,
  transformMulticlassingForStorage,
} from '@/utils/characterTransformations';
import { convertSpellIdsToDatabase } from '@/utils/spell-id-mapping';

// Project Types

// Services

/**
 * Constant UUID for local users when no authentication is present
 * This follows the UUID v4 format required by Supabase
 */
const LOCAL_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Custom hook for handling character data persistence
 * Provides methods and state for saving character data to Supabase
 */
export const useCharacterSave = (): {
  saveCharacter: (character: Character) => Promise<Character | null>;
  isSaving: boolean;
} => {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { state: campaignState } = useCampaign();
  const { user } = useAuth();

  /**
   * Generate background image for the character
   * This runs asynchronously after character creation
   */
  const generateBackgroundImage = useCallback(async (
    characterId: string,
    character: Character,
  ): Promise<void> => {
    try {
      logger.info(`Generating background image for character ${characterId}`);

      // Generate the image with character portrait as reference if available
      const options: {
        referenceImageUrl?: string;
        retryAttempts?: number;
        fallbackToDefault?: boolean;
        useSimplifiedPrompt?: boolean;
      } = {};
      if (character.image_url) {
        options.referenceImageUrl = character.image_url;
        logger.info(`Using character image as reference: ${character.image_url}`);
      }

      const imageUrl = await characterBackgroundGenerator.generateCharacterBackground(
        character,
        options,
      );

      // Update the character with the generated image URL
      try {
        await userDataApi.updateCharacter(characterId, {
          background_image: imageUrl,
        });
        logger.info(
          `Successfully generated and saved background image for character ${characterId}`,
        );

        // Invalidate specific queries to refresh the UI with the new image
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        queryClient.invalidateQueries({ queryKey: ['character', characterId] });

        // Show success notification
        toast({
          title: 'Character Background Generated',
          description: 'Your character background image has been created successfully.',
        });
      } catch (error) {
        logger.error('Error updating character with background image:', error);
      }
    } catch (error) {
      logger.error(`Failed to generate background image for character ${characterId}:`, error);

      // Show user-friendly error notification
      toast({
        title: 'Background Image Generation Failed',
        description:
          "We couldn't generate a background image for your character, but your character was created successfully. You can add an image later.",
        variant: 'destructive',
      });

      // Don't throw error - character creation should still succeed even if image generation fails
    }
  }, [toast, queryClient]);

  /**
   * Saves character data to Supabase
   * Handles both creation and updates of character data
   * @param character - The character data to save
   * @returns Promise<Character | null> The saved character data or null if save failed
   */
  const saveCharacter = useCallback(async (character: Character): Promise<Character | null> => {
    if (!character) return null;

    try {
      setIsSaving(true);

      const effectiveCampaignId = character.campaign_id || campaignState.campaign?.id || null;

      // Transform and save character data
      const characterData = {
        ...transformCharacterForStorage({
          ...character,
          campaign_id: effectiveCampaignId,
          // Use authenticated user ID if available, otherwise use local UUID
          user_id: user?.id || LOCAL_USER_ID,
        }),
        ...transformMulticlassingForStorage(character),
      };

      logger.info('Saving character data:', characterData);

      // ⚡ Bolt: Define internal spell save helper to allow parallelization
      const saveSpells = async (id: string): Promise<void> => {
        if (
          (!character.cantrips || character.cantrips.length === 0) &&
          (!character.knownSpells || character.knownSpells.length === 0)
        ) {
          return;
        }

        try {
          const frontendSpellIds = [
            ...(character.cantrips || []),
            ...(character.knownSpells || []),
          ];
          const databaseSpellIds = convertSpellIdsToDatabase(frontendSpellIds);

          if (databaseSpellIds.length > 0) {
            await characterSpellService.saveCharacterSpells(id, {
              spells: databaseSpellIds,
              className: character.class?.name || '',
            });
            logger.info(`✅ Successfully saved spells for character ${id}`);
          }
        } catch (spellError) {
          logger.warn('❌ Spell save failed but continuing:', spellError);
          if (!character.id) {
            toast({
              title: 'Partial Save Success',
              description: 'Character created but spell assignment failed.',
              variant: 'destructive',
            });
          }
        }
      };

      // For new characters, use atomic RPC function
      let savedCharacter: Character;
      if (!characterData.id) {
        // Transform stats data
        const statsData = transformAbilityScoresForStorage(
          character.abilityScores!,
          '00000000-0000-0000-0000-000000000000', // Temporary ID, will be replaced
        );

        // Transform equipment data if present
        const equipmentData =
          character.inventory && character.inventory.length > 0
            ? transformEquipmentForStorage(character, '00000000-0000-0000-0000-000000000000')
            : null;

        const createdCharacter = await userDataApi.createCharacter({
          ...characterData,
          stats: {
            strength: statsData.strength,
            dexterity: statsData.dexterity,
            constitution: statsData.constitution,
            intelligence: statsData.intelligence,
            wisdom: statsData.wisdom,
            charisma: statsData.charisma,
            armor_class: statsData.armor_class,
            current_hit_points: statsData.current_hit_points,
            max_hit_points: statsData.max_hit_points,
          },
          equipment: equipmentData || undefined,
        });
        const newCharacterId = createdCharacter.id;
        characterData.id = newCharacterId;
        savedCharacter = { ...character, id: newCharacterId, campaign_id: effectiveCampaignId };

        // Save spells after creation (needs the new ID)
        await saveSpells(newCharacterId);
      } else {
        // Check authentication for updates
        if (!user) {
          throw new Error('Authentication required for updating characters');
        }

        // ⚡ Bolt: Parallelize all database operations for existing characters.
        // This reduces database round-trips and improves save performance.
        const statsData = transformAbilityScoresForStorage(
          character.abilityScores!,
          characterData.id,
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const promises: Promise<any>[] = [
          userDataApi.updateCharacter(characterData.id, characterData),
          userDataApi.updateCharacterStats(characterData.id, statsData),
          saveSpells(characterData.id),
        ];

        if (character.inventory && character.inventory.length > 0) {
          const equipmentData = transformEquipmentForStorage(character, characterData.id);
          promises.push(
            Promise.resolve(
              supabase.from('character_equipment').upsert(equipmentData, {
                onConflict: 'character_id,item_name',
              }),
            ),
          );
        }

        const results = await Promise.all(promises);

        // Check for core character update error (first promise)
        const updateResult = results[0];
        if (updateResult?.error) throw updateResult.error;

        // Log warnings for other potential failures but don't fail the entire operation
        if (results[1]?.error) logger.warn('Stats save failed but continuing:', results[1].error);
        if (results[3]?.error)
          logger.warn('Equipment save failed but continuing:', results[3].error);

        savedCharacter = { ...character, campaign_id: effectiveCampaignId };
      }

      // Generate background image asynchronously for new characters
      // Don't block character creation on image generation
      if (!character.id && characterData.id) {
        generateBackgroundImage(characterData.id, savedCharacter);
      }

      // Invalidate queries for character lists
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      if (effectiveCampaignId) {
        queryClient.invalidateQueries({
          queryKey: ['campaign', effectiveCampaignId, 'characters'],
        });
      }
      queryClient.invalidateQueries({ queryKey: ['character', characterData.id] });

      // Return the complete character data
      return savedCharacter;
    } catch (error: unknown) {
      logger.error('Error saving character:', error);
      toast({
        title: 'Save Error',
        description: `Failed to save character: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [campaignState.campaign?.id, user?.id, toast, queryClient, generateBackgroundImage]);

  return useMemo(() => ({
    saveCharacter,
    isSaving,
  }), [saveCharacter, isSaving]);
};
