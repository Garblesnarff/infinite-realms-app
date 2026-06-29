/**
 * useCharacterData Hook
 *
 * This hook is responsible for fetching and managing detailed character data
 * from Supabase, including basic info, stats, and equipment. It also handles
 * validation of the character ID and navigation in case of errors or if the
 * character is not found.
 *
 * Main Hook:
 * - useCharacterData: Fetches and provides character data.
 *
 * Key Dependencies:
 * - React (useState, useEffect, useCallback)
 * - React Router (useNavigate)
 * - Supabase client (`@/integrations/supabase/client`)
 * - useToast hook (`@/hooks/use-toast`)
 * - Character type (`@/types/character`)
 * - isValidUUID utility (`@/utils/validation`)
 * - data-transformers utility (`@/utils/character/data-transformers`)
 *
 * @author AI Dungeon Master Team
 */

// SDK Imports
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// Project Imports
import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import {
  transformCharacterData,
  type CharacterRow,
  type CharacterStatsRow,
  type CharacterEquipmentRow,
} from '@/utils/character/data-transformers';
import { isValidUUID } from '@/utils/validation';

interface UseCharacterDataReturn {
  character: Character | null;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Custom hook for fetching and managing character data
 * Handles data fetching, error states, and loading states
 * @param characterId - UUID of the character to fetch
 * @returns Object containing character data, loading state, and refetch function
 */
export const useCharacterData = (characterId: string | undefined): UseCharacterDataReturn => {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  /**
   * Validates character ID and handles invalid cases
   * @param id - Character ID to validate
   * @returns Boolean indicating if ID is valid
   */
  const validateCharacterId = useCallback(
    (id: string | undefined): id is string => {
      if (!id || !isValidUUID(id)) {
        toast({
          title: 'Invalid Character',
          description: 'The character ID is invalid. Redirecting to characters page.',
          variant: 'destructive',
        });
        navigate('/app/characters');
        return false;
      }
      return true;
    },
    [navigate, toast],
  );

  /**
   * Fetches character data from Supabase
   * Includes basic info, stats, and equipment
   */
  const fetchCharacter = useCallback(async (): Promise<void> => {
    if (!validateCharacterId(characterId)) {
      return;
    }

    try {
      setLoading(true);

      // Check WorkOS authentication
      if (!user) {
        toast({
          title: 'Not Authenticated',
          description: 'Please log in to view your characters.',
          variant: 'destructive',
        });
        navigate('/login');
        return;
      }

      // ⚡ Bolt: Fetch character data with stats and equipment in a single query.
      // This reduces database round-trips from 2 to 1 and improves loading performance.
      // Explicit column selection avoids over-fetching data.
      const { data: characterData, error: characterError } = await supabase
        .from('characters')
        .select(
          `
          id, user_id, name, description, race, class, level, background,
          experience_points, alignment, avatar_url, image_url, background_image,
          appearance, personality_traits, backstory_elements, vision_types,
          obscurement, is_hidden, stealth_check_bonus, cantrips, known_spells,
          prepared_spells, ritual_spells,
          character_stats(
            strength, dexterity, constitution, intelligence, wisdom, charisma
          ),
          character_equipment(*)
        `,
        )
        .eq('id', characterId)
        .or(`user_id.eq.${user.id},owner_id.eq.${user.id}`) // CRITICAL: Dual ownership check
        .maybeSingle();

      if (characterError) {
        throw characterError;
      }

      if (!characterData) {
        toast({
          title: 'Character Not Found',
          description:
            'The requested character could not be found. Redirecting to characters page.',
          variant: 'destructive',
        });
        navigate('/app/characters');
        return;
      }

      // Extract character data and stats
      const characterRecord = Array.isArray(characterData) ? characterData[0] : characterData;
      const statsData = Array.isArray(characterRecord.character_stats)
        ? characterRecord.character_stats[0]
        : characterRecord.character_stats;

      // ⚡ Bolt: equipmentData is now pre-fetched via the joined query
      const equipmentData = characterRecord.character_equipment;

      // Transform and set character data
      const transformedCharacter = transformCharacterData(
        characterRecord as unknown as CharacterRow,
        statsData as CharacterStatsRow | null,
        equipmentData as CharacterEquipmentRow[] | null,
      );

      setCharacter(transformedCharacter);
    } catch (error) {
      logger.error('Error fetching character:', error);
      toast({
        title: 'Error',
        description: 'Failed to load character data. Please try again.',
        variant: 'destructive',
      });
      navigate('/characters');
    } finally {
      setLoading(false);
    }
  }, [characterId, navigate, toast, user, validateCharacterId]);

  // Fetch character data on mount or when characterId changes
  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  return { character, loading, refetch: fetchCharacter };
};
