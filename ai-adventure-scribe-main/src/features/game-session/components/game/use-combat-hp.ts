import { useEffect, useState } from 'react';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getParticipantStatus } from '@/services/combat/damage-integrator';

export interface CombatHP {
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_conscious: boolean;
}

/**
 * Fetches and subscribes to a character's active-combat HP status.
 * Returns null when the character has no active combat participant.
 */
export function useCombatHP(characterId: string | undefined): CombatHP | null {
  const [combatHP, setCombatHP] = useState<CombatHP | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    if (!characterId) {
      return;
    }

    const fetchCombatStatus = async (): Promise<void> => {
      try {
        // Find active combat encounter for this character
        const { data: participant, error } = await supabase
          .from('combat_participants')
          .select('id, encounter_id')
          .eq('character_id', characterId)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error || !participant) {
          setCombatHP(null);
          setParticipantId(null);
          return;
        }

        setParticipantId(participant.id);

        // Get current HP status
        const status = await getParticipantStatus(participant.id);
        if (status) {
          setCombatHP({
            current_hp: status.current_hp,
            max_hp: status.max_hp,
            temp_hp: status.temp_hp,
            is_conscious: status.is_conscious,
          });
        }
      } catch (error) {
        logger.error('[useCombatHP] Failed to fetch combat status:', error);
      }
    };

    fetchCombatStatus();
  }, [characterId]);

  // Subscribe to real-time HP updates
  useEffect(() => {
    if (!participantId) return;

    const subscription = supabase
      .channel(`combat_status_${participantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'combat_participant_status',
          filter: `participant_id=eq.${participantId}`,
        },
        async (payload) => {
          logger.info('[useCombatHP] HP status updated:', payload);

          if (payload.eventType === 'DELETE') {
            setCombatHP(null);
            return;
          }

          // ⚡ Bolt: Use data from payload directly to avoid redundant network request.
          // This eliminates one network round-trip per HP update.
          const newData = payload.new as Record<string, unknown>;
          if (newData) {
            setCombatHP({
              current_hp: newData.current_hp,
              max_hp: newData.max_hp,
              temp_hp: newData.temp_hp,
              is_conscious: newData.is_conscious,
            });
          }
        },
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [participantId]);

  return combatHP;
}
