import React from 'react';
import { useNavigate } from 'react-router-dom';

import { transformCharacterData } from '../components/list/transform-character-data';

import type { Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { subscriptionManager } from '@/services/supabase-subscription-manager';
import { addNetworkListener, isOffline } from '@/utils/network';

export interface UseCharacterListDataReturn {
  characters: Partial<Character>[];
  filteredCharacters: Partial<Character>[];
  loading: boolean;
  offlineMode: boolean;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  fetchCharacters: (opts?: { suppressLoader?: boolean }) => Promise<void>;
}

/**
 * Loads the current user's characters, keeping them in sync with an
 * offline cache, network status, and Supabase realtime updates.
 */
export function useCharacterListData(): UseCharacterListDataReturn {
  const [cachedCharacters, setCachedCharacters] = useLocalStorage<Partial<Character>[]>(
    'aas_cached_characters',
    [],
  );
  const [characters, setCharacters] = React.useState<Partial<Character>[]>([]);
  const [filteredCharacters, setFilteredCharacters] = React.useState<Partial<Character>[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [offlineMode, setOfflineMode] = React.useState(isOffline());
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const cachedCharactersRef = React.useRef<Partial<Character>[]>(cachedCharacters);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const offlineNoticeShown = React.useRef(false);

  React.useEffect(() => {
    cachedCharactersRef.current = cachedCharacters;
  }, [cachedCharacters]);

  /**
   * Fetches all characters for the current user from Supabase
   */
  const fetchCharacters = React.useCallback(
    async ({ suppressLoader = false }: { suppressLoader?: boolean } = {}) => {
      try {
        if (!suppressLoader) {
          setLoading(true);
        }

        if (isOffline()) {
          setOfflineMode(true);
          if (!offlineNoticeShown.current) {
            toast({
              title: 'Offline mode',
              description:
                cachedCharactersRef.current.length > 0
                  ? 'You are viewing cached characters. Changes will sync when you reconnect.'
                  : 'You appear to be offline. Reconnect to load your characters.',
            });
            offlineNoticeShown.current = true;
          }
          setCharacters(cachedCharactersRef.current);
          return;
        }

        setOfflineMode(false);
        offlineNoticeShown.current = false;

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

        setCurrentUserId(user.id);

        const { data, error } = await supabase
          .from('characters')
          .select(
            `
          id, name, race, class, level,
          image_url, avatar_url, background_image,
          campaign_id,
          created_at, updated_at,
          character_stats!left (
            strength, dexterity, constitution, intelligence, wisdom, charisma,
            max_hit_points, current_hit_points, armor_class
          )
        `,
          )
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        const transformedData = transformCharacterData(data || []);
        setCharacters(transformedData);
        setCachedCharacters(transformedData);
      } catch (error) {
        logger.error('Error fetching characters:', error);
        toast({
          title: 'Error',
          description: 'Failed to load characters',
          variant: 'destructive',
        });
      } finally {
        if (!suppressLoader) {
          setLoading(false);
        }
      }
    },
    [toast, navigate, setCachedCharacters, user],
  );

  React.useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  React.useEffect(() => {
    const disposers: Array<() => void> = [];
    disposers.push(
      addNetworkListener('online', () => {
        setOfflineMode(false);
        fetchCharacters();
      }),
    );
    disposers.push(
      addNetworkListener('offline', () => {
        setOfflineMode(true);
        setCharacters(cachedCharactersRef.current);
      }),
    );

    return () => {
      disposers.forEach((dispose) => dispose());
    };
  }, [fetchCharacters]);

  React.useEffect(() => {
    if (!currentUserId) return;

    const callbackId = subscriptionManager.subscribeToEvents('characters', {
      events: ['INSERT', 'UPDATE', 'DELETE'],
      filter: (payload) => {
        const payloadUserId =
          (payload.new as { user_id?: string } | null | undefined)?.user_id ??
          (payload.old as { user_id?: string } | null | undefined)?.user_id;
        return payloadUserId === currentUserId;
      },
      callback: () => {
        fetchCharacters({ suppressLoader: true }).catch((error) => {
          logger.error('Failed to refresh characters after realtime update:', error);
        });
      },
    });

    return () => {
      subscriptionManager.unsubscribeFromEvents('characters', callbackId);
    };
  }, [currentUserId, fetchCharacters]);

  // Filter characters based on search term
  React.useEffect(() => {
    if (searchTerm === '') {
      setFilteredCharacters(characters);
    } else {
      const filtered = characters.filter(
        (character: Partial<Character>) =>
          character.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (typeof character.race !== 'string' ? character.race?.name : character.race)
            ?.toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          (typeof character.class !== 'string' ? character.class?.name : character.class)
            ?.toLowerCase()
            .includes(searchTerm.toLowerCase()),
      );
      setFilteredCharacters(filtered);
    }
  }, [characters, searchTerm]);

  return {
    characters,
    filteredCharacters,
    loading,
    offlineMode,
    searchTerm,
    setSearchTerm,
    fetchCharacters,
  };
}
