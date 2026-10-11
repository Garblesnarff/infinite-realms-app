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
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

// Project Imports
import { logger } from '../lib/logger';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast'; // Assuming kebab-case from previous steps
import { issue1784Api } from '@/services/issue-1784-api';
import { userDataApi } from '@/services/user-data-api';
import {
  findUnresolvedCharacterData,
  serializePersonalityEnvelope,
  transformCharacterData,
  type CharacterRow,
  type CharacterStatsRow,
  type CharacterEquipmentRow,
} from '@/utils/character/data-transformers';
import { isValidUUID } from '@/utils/validation'; // Assuming kebab-case

/**
 * #2701: builds the PUT payload for a character-sheet edit.
 *
 * The sheet's managers call `onUpdate(updatedCharacter)` with a full Character
 * object, but the server only accepts its whitelisted columns (see
 * prepareCharacterPayload). This maps exactly the fields the sheet edits —
 * experience, level, notes, appearance, description, backstory, personality —
 * from the client shape to the DB columns, and only the fields that actually
 * changed. Feature uses travel as `class_features` (#224). Hit points and the
 * other rest results stay on the rest route, so a hit-point-only diff is still
 * an empty payload: no write, just refresh.
 *
 * The trait/ideal/bond/flaw arrays and inspiration state have no dedicated
 * columns; they travel as the JSON personality envelope in `personality_notes`.
 */
export const buildSheetUpdatePayload = (
  prev: Character | null,
  next: Character,
): Record<string, unknown> => {
  if (!prev) return {};
  const payload: Record<string, unknown> = {};

  const changedString = (
    prevValue: string | null | undefined,
    nextValue: string | null | undefined,
  ): boolean => (prevValue ?? '') !== (nextValue ?? '');

  if (prev.experience !== next.experience) payload.experience_points = next.experience ?? 0;
  if (prev.level !== next.level) payload.level = next.level ?? 1;
  if (changedString(prev.sessionNotes, next.sessionNotes))
    payload.session_notes = next.sessionNotes ?? '';
  if (changedString(prev.appearance, next.appearance)) payload.appearance = next.appearance ?? '';
  if (changedString(prev.description, next.description))
    payload.description = next.description ?? '';
  if (changedString(prev.backstory_elements, next.backstory_elements))
    payload.backstory_elements = next.backstory_elements ?? '';
  if (changedString(prev.personality_traits, next.personality_traits))
    payload.personality_traits = next.personality_traits ?? '';

  // The envelope owns personality_notes: compare canonically serialized forms.
  if (serializePersonalityEnvelope(prev) !== serializePersonalityEnvelope(next)) {
    payload.personality_notes = serializePersonalityEnvelope(next);
  }

  if (JSON.stringify(prev.classFeatures ?? null) !== JSON.stringify(next.classFeatures ?? null)) {
    payload.class_features = next.classFeatures ?? {};
  }

  // #204: wizard quirk picks; the sheet itself does not edit these, but the
  // diff keeps the single writer complete if a flow ever hands back a
  // character with changed selections.
  if (
    JSON.stringify(prev.enhancementSelections ?? null) !==
    JSON.stringify(next.enhancementSelections ?? null)
  ) {
    payload.enhancement_selections = next.enhancementSelections ?? [];
  }

  return payload;
};

/**
 * Custom hook for fetching and managing character data
 * Handles data fetching, error states, and loading states
 * @param characterId - UUID of the character to fetch
 * @returns Object containing character data, loading state, and refetch function
 */
export const useCharacterData = (characterId: string | undefined) => {
  const [character, setCharacter] = useState<Character | null>(null);
  // Stored race/class/background names the client tables do not know ("Unknown race:
  // Satyr"). The sheet still renders; these tell the reader why a section looks bare.
  const [unresolvedData, setUnresolvedData] = useState<string[]>([]);
  // The equipment request failed; the sheet renders without equipment and says so (#2150).
  const [equipmentUnavailable, setEquipmentUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  // Latest loaded character for the update diff; the managers hand back a new
  // object, so the diff needs the pre-edit one, not a stale closure.
  const characterRef = useRef<Character | null>(null);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

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
   *
   * #2701: `silent` skips the loading flag so a post-save refresh does not
   * show the skeleton — the skeleton unmounts the tabs and resets the active
   * tab to Main.
   */
  const fetchCharacter = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!validateCharacterId(characterId)) return;

      // Which step threw, so the toast and the log say more than "failed" (#2150).
      let stage = 'fetching the character';
      try {
        if (!options?.silent) {
          setLoading(true);
        }

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

        stage = 'reading the character data';
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

        const unresolved = findUnresolvedCharacterData(characterRecord as CharacterRow);
        if (unresolved.length > 0) {
          logger.warn('Character sheet rendering with unresolved character data', {
            characterId,
            unresolved,
          });
        }

        setUnresolvedData(unresolved);
        setEquipmentUnavailable(Boolean(equipmentResult.error));
        setCharacter(transformedCharacter);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error(`Error ${stage}`, { characterId, stage, reason, error });
        toast({
          title: 'Failed to load character data',
          description: `Error while ${stage}: ${reason}`,
          variant: 'destructive',
        });
        // #2701: a silent post-save refresh must not kick the user off the
        // sheet; the save already landed and the sheet keeps its current state.
        if (!options?.silent) {
          navigate('/app/characters');
        }
      } finally {
        setLoading(false);
      }
    },
    [characterId, user, toast, navigate, validateCharacterId],
  );

  // Fetch character data on mount or when dependencies change
  // ⚡ Bolt: Now only depends on the stable fetchCharacter callback.
  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  /**
   * #2701: the sheet's save path. The managers call this with the edited
   * character; the changed fields are written through the existing character
   * update API (PUT /v1/characters/:id, whitelisted by prepareCharacterPayload
   * inside userDataApi.updateCharacter — no second writer), then the sheet
   * refreshes silently so the tabs stay mounted and the active tab is kept.
   * Resolves true when the write landed; the caller shows its success toast
   * only then. On failure an error toast fires here and the sheet reloads the
   * last saved state.
   */
  const persistCharacterUpdate = useCallback(
    async (updatedCharacter: Character): Promise<boolean> => {
      // Structural guarantee: this never rejects, so the fire-and-forget
      // `void onUpdate(...)` call sites cannot produce unhandled rejections.
      try {
        if (!validateCharacterId(characterId)) return false;

        const payload = buildSheetUpdatePayload(characterRef.current, updatedCharacter);
        if (Object.keys(payload).length > 0) {
          try {
            await userDataApi.updateCharacter(characterId!, payload);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.error('Failed to save character sheet update', {
              characterId,
              reason,
              error,
            });
            toast({
              title: 'Save failed',
              description: `Your changes could not be saved: ${reason}`,
              variant: 'destructive',
            });
            // Reload the last saved state so the sheet does not show edits
            // that never landed.
            await fetchCharacter({ silent: true });
            return false;
          }
        }
        await fetchCharacter({ silent: true });
        return true;
      } catch (error) {
        logger.error('Unexpected error saving character sheet update', {
          characterId,
          error,
        });
        toast({
          title: 'Save failed',
          description: 'Your changes could not be saved.',
          variant: 'destructive',
        });
        return false;
      }
    },
    [characterId, validateCharacterId, toast, fetchCharacter],
  );

  return useMemo(
    () => ({
      character,
      unresolvedData,
      equipmentUnavailable,
      loading,
      refetch: fetchCharacter,
      persistCharacterUpdate,
    }),
    [
      character,
      unresolvedData,
      equipmentUnavailable,
      loading,
      fetchCharacter,
      persistCharacterUpdate,
    ],
  );
};
