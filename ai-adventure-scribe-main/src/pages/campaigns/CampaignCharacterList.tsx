/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import type { Character } from '@/types/character';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { MemoizedCharacterCard } from '@/features/character/components/list/character-card';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { subscriptionManager } from '@/services/supabase-subscription-manager';

const CampaignCharacterList: React.FC = () => {
  const { id: campaignId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['campaign', campaignId, 'characters'],
    queryFn: async () => {
      // ⚡ Bolt: Optimized character query to exclude high-bandwidth text columns (backstory, traits, etc.)
      // which are not used by the character card. This significantly reduces payload size for lists.
      const { data, error } = await supabase
        .from('characters')
        .select(
          `
          id, name, race, class, level, avatar_url, background_image, created_at,
          character_stats!left (
            strength, dexterity, constitution, intelligence, wisdom, charisma,
            max_hit_points, current_hit_points, armor_class
          )
        `,
        )
        .eq('campaign_id', campaignId as string)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: Boolean(campaignId),
  });

  React.useEffect(() => {
    if (!campaignId) return;

    const callbackId = subscriptionManager.subscribeToEvents('characters', {
      events: ['INSERT', 'UPDATE', 'DELETE'],
      filter: (payload) => {
        const newCampaignId = (payload.new as { campaign_id?: string } | null | undefined)
          ?.campaign_id;
        const oldCampaignId = (payload.old as { campaign_id?: string } | null | undefined)
          ?.campaign_id;
        return newCampaignId === campaignId || oldCampaignId === campaignId;
      },
      callback: (payload) => {
        const queryKey: [string, string | undefined, string] = [
          'campaign',
          campaignId,
          'characters',
        ];
        if (payload.eventType === 'DELETE' || payload.eventType === 'INSERT') {
          logger.debug('Characters realtime change detected, invalidating query', {
            eventType: payload.eventType,
            id: (payload.new ?? payload.old)?.id,
          });
          queryClient.invalidateQueries({ queryKey, exact: true });
          return;
        }

        if (payload.eventType === 'UPDATE' && payload.new) {
          queryClient.setQueryData(queryKey, (previous: any) => {
            if (!Array.isArray(previous)) {
              return previous;
            }

            const index = previous.findIndex((row: any) => row.id === (payload.new as any).id);
            if (index === -1) {
              return previous;
            }

            const updatedRow = {
              ...previous[index],
              ...payload.new,
            };

            const next = [...previous];
            next[index] = updatedRow;
            return next;
          });
        }
      },
    });

    return () => {
      subscriptionManager.unsubscribeFromEvents('characters', callbackId);
    };
  }, [campaignId, queryClient]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  // ⚡ Bolt: Removed redundant transformCharacterData function that performed
  // an unnecessary shallow copy of the character array on every render.
  const characters = (data || []) as Partial<Character>[];

  if (!characters.length) {
    return (
      <EmptyState
        illustration="no-characters"
        variant="card"
        title="No Characters Yet"
        description="Every epic saga needs its heroes. Create your first character to begin the journey."
        className="mt-8"
        action={
          <Button
            onClick={() => navigate(`/app/characters/new?campaign=${campaignId}`)}
            variant="cosmic"
          >
            Create Character
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-2">
      {characters.map((character) => {
        if (!character.id || !character.name) return null;
        return (
          <MemoizedCharacterCard
            key={character.id}
            character={character as Partial<Character> & { id: string; name: string }}
            onDelete={() => refetch()}
          />
        );
      })}
    </div>
  );
};

export default CampaignCharacterList;
