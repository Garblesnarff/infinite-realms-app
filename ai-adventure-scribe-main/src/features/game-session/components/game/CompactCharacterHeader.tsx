/* eslint-disable max-lines */
import { Heart, Shield, Zap, Skull } from 'lucide-react';
import React, { useEffect, useState, useMemo, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCharacter } from '@/contexts/CharacterContext';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getParticipantStatus } from '@/services/combat/damage-integrator';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

// ⚡ Bolt: Move helper functions and static constants outside the component definition
// to avoid re-creation on every render.
const getModifier = (score?: number): string => {
  if (!score) return '+0';
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const DEFAULT_BACKGROUND_IMAGE = new URL('/card-background.jpeg', import.meta.url).href;

/**
 * CompactCharacterHeader - Quick view of character essentials for game sidebar
 * Extracts core stats from CharacterContext for at-a-glance access during gameplay
 *
 * Dependencies:
 * - CharacterContext for live character data
 * - lucide-react for icons
 * - ui/card, ui/button for styling
 *
 * Usage: Render in sidebar tabs; updates automatically on character changes
 */
export const CompactCharacterHeader: React.FC = React.memo(() => {
  const { state: characterState } = useCharacter();

  // ⚡ Bolt: Wrap character initialization in useMemo to avoid re-calculating dependency objects
  const character = useMemo(
    () => (characterState.character || {}) as Record<string, unknown>,
    [characterState.character],
  );

  // Combat HP state
  const [combatHP, setCombatHP] = useState<{
    current_hp: number;
    max_hp: number;
    temp_hp: number;
    is_conscious: boolean;
  } | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

  // Fetch combat HP if character is in an active combat
  useEffect(() => {
    if (!character?.id) {
      return;
    }

    const fetchCombatStatus = async (): Promise<void> => {
      try {
        // Find active combat encounter for this character
        const { data: participant, error } = await supabase
          .from('combat_participants')
          .select('id, encounter_id')
          .eq('character_id', character.id)
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
        logger.error('[CompactCharacterHeader] Failed to fetch combat status:', error);
      }
    }

    fetchCombatStatus();
  }, [character?.id]);

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
          logger.info('[CompactCharacterHeader] HP status updated:', payload);

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

  // Debug logging
  useEffect(() => {
    logger.debug('[CompactCharacterHeader] Character data:', {
      name: character?.name,
      avatar_url: character?.avatar_url,
      image_url: character?.image_url,
      background_image: character?.background_image,
      combatHP,
    });
  }, [character, combatHP]);

  // ⚡ Bolt: Memoize all derived stats to prevent recalculation on every render.
  // Using centralized calculateAllCharacterStats for consistency and correctness.
  const stats = useMemo(() => {
    if (!characterState.character) return null;

    const charStats = calculateAllCharacterStats(characterState.character);

    return {
      maxHp: charStats.hitPoints,
      armorClass: charStats.armorClass,
      proficiency: charStats.proficiencyBonus,
    };
  }, [characterState.character]);

  const handleShortRest = useCallback(() => {
    logger.info('Short rest initiated');
  }, []);

  const handleLongRest = useCallback(() => {
    logger.info('Long rest initiated');
  }, []);

  const backgroundImage = useMemo(
    () => character.background_image || DEFAULT_BACKGROUND_IMAGE,
    [character.background_image],
  );

  if (!characterState.character) {
    return (
      <Card className="p-4 text-center text-muted-foreground">
        <p>No character loaded</p>
      </Card>
    );
  }

  const { maxHp, armorClass, proficiency } = stats!;

  return (
    <Card
      className="group overflow-hidden border-2 border-border/30 hover:border-infinite-gold/70 relative transition-all duration-500 bg-cover bg-center"
      style={{
        backgroundImage: `url(${backgroundImage})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/80" />

      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
      >
        <div className="absolute inset-0 shadow-[inset_0_0_20px_rgba(168,85,247,0.3)]" />
      </div>

      {/* Avatar */}
      {character.avatar_url && (
        <div className="relative flex justify-center pt-4" style={{ zIndex: Z_INDEX.SIDEBAR }}>
          <img
            src={character.avatar_url}
            alt={`${character.name} avatar`}
            className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 hover:scale-110 hover:border-infinite-purple hover:shadow-infinite-purple/70"
          />
        </div>
      )}

      {/* Content */}
      <div className="p-4 pt-3 space-y-3 relative" style={{ zIndex: Z_INDEX.SIDEBAR }}>
        <div className="text-center">
          <h3 className="font-semibold text-lg text-white">{character.name}</h3>
          <p className="text-sm text-gray-300">
            Level {character.level} {character.race?.name} {character.class?.name}
          </p>
        </div>

        {/* HP and AC */}
        <div className="flex gap-4 text-sm justify-center text-white">
          <div
            className="flex items-center gap-1"
            aria-label={
              combatHP
                ? `Hit Points: ${combatHP.current_hp} out of ${combatHP.max_hp}${combatHP.temp_hp > 0 ? ` plus ${combatHP.temp_hp} temporary` : ''}`
                : `Hit Points: ${maxHp}`
            }
          >
            {combatHP ? (
              <>
                {combatHP.is_conscious ? (
                  <Heart
                    className={`w-4 h-4 ${
                      combatHP.current_hp === 0
                        ? 'text-gray-500'
                        : combatHP.current_hp / combatHP.max_hp <= 0.25
                          ? 'text-red-600 animate-pulse'
                          : combatHP.current_hp / combatHP.max_hp <= 0.5
                            ? 'text-orange-400'
                            : 'text-red-400'
                    }`}
                    aria-hidden="true"
                  />
                ) : (
                  <Skull className="w-4 h-4 text-gray-500 animate-pulse" aria-hidden="true" />
                )}
                <span className="font-semibold" aria-hidden="true">
                  HP:
                </span>
                <span
                  className={
                    combatHP.current_hp === 0
                      ? 'text-gray-500'
                      : combatHP.current_hp / combatHP.max_hp <= 0.25
                        ? 'text-red-400 font-bold'
                        : ''
                  }
                  aria-hidden="true"
                >
                  {combatHP.current_hp}
                </span>
                <span className="text-gray-400" aria-hidden="true">
                  /
                </span>
                <span aria-hidden="true">{combatHP.max_hp}</span>
                {combatHP.temp_hp > 0 && (
                  <span className="text-blue-300 font-semibold ml-1" aria-hidden="true">
                    (+{combatHP.temp_hp})
                  </span>
                )}
              </>
            ) : (
              <>
                <Heart className="w-4 h-4 text-red-400" aria-hidden="true" />
                <span className="font-semibold" aria-hidden="true">
                  HP:
                </span>
                <span aria-hidden="true">{maxHp}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1" aria-label={`Armor Class: ${armorClass}`}>
            <Shield className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <span className="font-semibold" aria-hidden="true">
              AC:
            </span>
            <span aria-hidden="true">{armorClass}</span>
          </div>
          <div
            className="flex items-center gap-1"
            aria-label={`Proficiency Bonus: +${proficiency}`}
          >
            <Zap className="w-4 h-4 text-green-400" aria-hidden="true" />
            <span className="font-semibold" aria-hidden="true">
              PROF:
            </span>
            <span aria-hidden="true">+{proficiency}</span>
          </div>
        </div>

        {/* Ability Scores Grid */}
        <div className="grid grid-cols-3 gap-2 text-xs" role="group" aria-label="Ability Scores">
          {[
            { label: 'STR', key: 'strength' },
            { label: 'DEX', key: 'dexterity' },
            { label: 'CON', key: 'constitution' },
            { label: 'INT', key: 'intelligence' },
            { label: 'WIS', key: 'wisdom' },
            { label: 'CHA', key: 'charisma' },
          ].map((score) => {
            const modifier = getModifier(
              character.abilityScores?.[score.key as keyof typeof character.abilityScores]?.score,
            );
            return (
              <div
                key={score.key}
                className="flex flex-col items-center p-2 bg-black/30 backdrop-blur-sm rounded border border-white/10"
                aria-label={`${score.label}: ${modifier}`}
              >
                <span className="font-semibold text-gray-400" aria-hidden="true">
                  {score.label}
                </span>
                <span className="text-lg font-bold text-white" aria-hidden="true">
                  {modifier}
                </span>
              </div>
            );
          })}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={handleShortRest} className="text-xs">
            Short Rest
          </Button>
          <Button size="sm" variant="outline" onClick={handleLongRest} className="text-xs">
            Long Rest
          </Button>
        </div>
      </div>
    </Card>
  );
});
