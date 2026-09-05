/**
 * useCharacterData Hook
 *
 * This hook is responsible for fetching and managing detailed character data
 * from the authenticated server APIs, including basic info, stats, and equipment. It also handles
 * validation of the character ID and navigation in case of errors or if the
 * character is not found.
 *
 * Main Hook:
 * - useCharacterData: Fetches and provides character data.
 *
 * Key Dependencies:
 * - React (useState, useEffect)
 * - React Router (useNavigate)
 * - Authenticated character API clients
 * - useToast hook (`@/hooks/use-toast`)
 * - Character type (`@/types/character`)
 * - isValidUUID utility (`@/utils/validation`)
 *
 * @author AI Dungeon Master Team
 */

// SDK Imports
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

// Project Imports
import { logger } from '../lib/logger';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case from previous steps
import { issue1784Api } from '@/services/issue-1784-api';
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
   * Fetches character data from the authenticated server APIs
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

      // Fetch the character and its ownership-checked equipment in parallel.
      const [characterData, equipmentResult] = await Promise.all([
        userDataApi.getCharacter(characterId!),
        issue1784Api
          .getCharacterEquipment(characterId!)
          .then((data) => ({ data, error: null }))
          .catch((error: unknown) => ({ data: null, error })),
      ]);

      // Equipment is supplementary to the character record. Throwing here discarded the
      // character payload that had already been fetched successfully in the same
      // Promise.all, so one bad column name took down the entire page. Degrade instead,
      // matching use-character-save.ts which logs and continues. See #1859.
      if (equipmentResult.error) {
        logger.warn('Character equipment query failed; rendering without equipment', {
          characterId,
          error: equipmentResult.error,
        });
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

      // Equipment is returned by the ownership-checked character route.
      const equipmentData = equipmentResult.error
        ? null
        : (equipmentResult.data as unknown as CharacterEquipmentRow[]);

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
      navigate('/app/characters');
    } finally {
      setLoading(false);
    }
  }, [characterId, user, toast, navigate, validateCharacterId]);

  // Fetch character data on mount or when dependencies change
  // ⚡ Bolt: Now only depends on the stable fetchCharacter callback.
  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  return useMemo(
    () => ({
      character,
      loading,
      refetch: fetchCharacter,
    }),
    [character, loading, fetchCharacter],
  );
};
