import { useQuery } from '@tanstack/react-query';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { userDataApi } from '@/services/user-data-api';

/**
 * Pure helper: returns the trimmed typed name when an existing roster row
 * (excluding the row whose id matches currentCharacterId) has a
 * case-insensitive match; otherwise null.
 */
export function findDuplicateHeroName(
  name: string,
  roster: ReadonlyArray<{ id?: string | null; name?: string | null }> | undefined,
  currentCharacterId?: string | null,
): string | null {
  const typed = name.trim();
  if (!typed) return null;
  const typedKey = typed.toLocaleLowerCase();
  if (!roster) return null;
  for (const row of roster) {
    if (currentCharacterId && row.id === currentCharacterId) continue;
    if (row.name?.trim().toLocaleLowerCase() === typedKey) {
      return typed;
    }
  }
  return null;
}

/**
 * Loads the signed-in user's own character roster. Uses the SAME query key
 * and request as src/features/campaign/hooks/use-character-selection.ts (the
 * #321 account roster), so the cache is shared. GET /v1/characters is scoped
 * server-side to the signed-in user.
 */
export function useOwnCharacterRoster(): Character[] {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ['characters', 'account', user?.id],
    queryFn: async () => userDataApi.listCharacters() as Promise<Character[]>,
    enabled: !!user?.id,
    retry: false,
    staleTime: 60_000,
  });
  return data ?? [];
}
