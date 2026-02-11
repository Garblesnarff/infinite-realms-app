/* eslint-disable max-lines */
import { Heart, Shield, Zap } from 'lucide-react';
import React, { useEffect, useMemo, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';

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
  const { state: combatState } = useCombat();

  // ⚡ Bolt: Wrap character initialization in useMemo to avoid re-calculating dependency objects
  const character = useMemo(() => characterState.character || ({} as any), [characterState.character]);

  // Debug logging
  useEffect(() => {
    logger.debug('[CompactCharacterHeader] Character data:', {
      name: character?.name,
      avatar_url: character?.avatar_url,
      image_url: character?.image_url,
      background_image: character?.background_image,
      inCombat: combatState.isInCombat,
    });
  }, [character, combatState.isInCombat]);

  // ⚡ Bolt: Memoize all derived stats to prevent recalculation on every render.
  // This ensures pure UI updates don't trigger expensive D&D calculations.
  const stats = useMemo(() => {
    if (!characterState.character) return null;

    const char = characterState.character;
    const lvl = char.level ?? 1;
    const hitDie = char.class?.hitDie ?? 8;
    const conMod = char.abilityScores?.constitution?.modifier ?? 0;
    const dexMod = char.abilityScores?.dexterity?.modifier ?? 0;
    const wisMod = char.abilityScores?.wisdom?.modifier ?? 0;

    // Calculate HP (max HP formula from character sheet)
    const maxHp = Math.max(1, lvl * hitDie + conMod * lvl);

    // Calculate AC with unarmored defense support
    let armorClass = 10 + dexMod;
    const className = (char.class?.name ?? '').toString().toLowerCase();
    const hasUnarmoredDefense = className === 'barbarian' || className === 'monk';
    const isWearingArmor = !!char.equippedArmor;

    if (hasUnarmoredDefense && !isWearingArmor) {
      if (className === 'barbarian') {
        armorClass = 10 + dexMod + conMod;
      } else if (className === 'monk') {
        armorClass = 10 + dexMod + wisMod;
      }
    }

    const proficiency = Math.floor((lvl - 1) / 4) + 2;

    return {
      maxHp,
      armorClass,
      proficiency,
      level: lvl
    };
  }, [characterState.character]);

  // ⚡ Bolt: Separate current HP calculation as it depends on combat state
  // which might change more frequently than base character stats.
  const currentHpData = useMemo(() => {
    if (!stats) return { currentHp: 0, isInjured: false };

    let combatCurrentHp = null;
    if (combatState.isInCombat && combatState.activeEncounter) {
      const playerParticipant = combatState.activeEncounter.participants.find(
        (p) => p.participantType === 'player'
      );
      if (playerParticipant) {
        combatCurrentHp = playerParticipant.currentHitPoints;
      }
    }

    const currentHp = combatCurrentHp ?? stats.maxHp;
    const isInjured = currentHp < stats.maxHp;

    return { currentHp, isInjured };
  }, [stats, combatState.isInCombat, combatState.activeEncounter]);

  const handleShortRest = useCallback(() => {
    logger.info('Short rest initiated');
  }, []);

  const handleLongRest = useCallback(() => {
    logger.info('Long rest initiated');
  }, []);

  const backgroundImage = useMemo(() =>
    character.background_image || DEFAULT_BACKGROUND_IMAGE
  , [character.background_image]);

  if (!characterState.character) {
    return (
      <Card className="p-4 text-center text-muted-foreground">
        <p>No character loaded</p>
      </Card>
    );
  }

  const { maxHp, armorClass, proficiency } = stats!;
  const { currentHp, isInjured } = currentHpData;

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
        <div
          className="relative flex justify-center pt-4"
          style={{ zIndex: Z_INDEX.SIDEBAR }}
        >
          <img
            src={character.avatar_url}
            alt={`${character.name} avatar`}
            className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 hover:scale-110 hover:border-infinite-purple hover:shadow-infinite-purple/70"
          />
        </div>
      )}

      {/* Content */}
      <div
        className="p-4 pt-3 space-y-3 relative"
        style={{ zIndex: Z_INDEX.SIDEBAR }}
      >
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
            aria-label={`Hit Points: ${currentHp} out of ${maxHp}`}
          >
            <Heart
              className={`w-4 h-4 ${isInjured ? 'text-red-500 animate-pulse' : 'text-red-400'}`}
              aria-hidden="true"
            />
            <span className="font-semibold" aria-hidden="true">
              HP:
            </span>
            <span className={isInjured ? 'text-red-400 font-bold' : ''} aria-hidden="true">
              {currentHp}/{maxHp}
            </span>
          </div>
          <div className="flex items-center gap-1" aria-label={`Armor Class: ${armorClass}`}>
            <Shield className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <span className="font-semibold" aria-hidden="true">
              AC:
            </span>
            <span aria-hidden="true">{armorClass}</span>
          </div>
          <div className="flex items-center gap-1" aria-label={`Proficiency Bonus: +${proficiency}`}>
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
            const modifier = getModifier(character.abilityScores?.[score.key as keyof typeof character.abilityScores]?.score);
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
