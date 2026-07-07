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
 * - React (useState, useEffect)
 * - React Router (useNavigate)
 * - Supabase client (`@/integrations/supabase/client`)
 * - useToast hook (`@/hooks/use-toast`)
 * - Character type (`@/types/character`)
 * - isValidUUID utility (`@/utils/validation`)
 *
 * @author AI Dungeon Master Team
 */

// SDK Imports
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// Project Imports
import { logger } from '../lib/logger';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case from previous steps
import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';
import {
  transformCharacterData,
  type CharacterRow,
  type CharacterStatsRow,
  type CharacterEquipmentRow,
} from '@/utils/character/data-transformers';
import { isValidUUID } from '@/utils/validation'; // Assuming kebab-case

/**
 * Custom hook for fetching and managing character data
 * Handles data fetching, error states, and loading states
 * @param characterId - UUID of the character to fetch
 * @returns Object containing character data, loading state, and refetch function
 */
export const useCharacterData = (characterId: string | undefined) => {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  /**
   * Validates character ID and handles invalid cases
   * @param id - Character ID to validate
   * @returns Boolean indicating if ID is valid
   *
   * ⚡ Bolt: Wrapped in useCallback to stabilize identity across renders.
   */
  const validateCharacterId = useCallback(
    (id: string | undefined): boolean => {
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
    [toast, navigate],
  );

  /**
   * Fetches character data from Supabase
   * Includes basic info, stats, and equipment
   *
   * ⚡ Bolt: Wrapped in useCallback to stabilize identity and prevent unnecessary re-fetches
   * when parent components re-render or unrelated state changes.
   */
  const fetchCharacter = useCallback(async () => {
    if (!validateCharacterId(characterId)) return;

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
      const [characterData, equipmentResult] = await Promise.all([
        userDataApi.getCharacter(characterId!),
        supabase.from('character_equipment').select('*').eq('character_id', characterId!),
      ]);
      if (equipmentResult.error) throw equipmentResult.error;

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
      const equipmentData = equipmentResult.data;

      // Transform and set character data
      const transformedCharacter = transformCharacterData(
        characterRecord as CharacterRow,
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
  }, [characterId, user, toast, navigate, validateCharacterId]);

  // Fetch character data on mount or when dependencies change
  // ⚡ Bolt: Now only depends on the stable fetchCharacter callback.
  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  return { character, loading, refetch: fetchCharacter };
};
