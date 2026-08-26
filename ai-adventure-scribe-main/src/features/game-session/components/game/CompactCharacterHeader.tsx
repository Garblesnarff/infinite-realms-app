import React, { useEffect, useMemo, useCallback } from 'react';

import { CharacterHeaderAbilityScores } from './CharacterHeaderAbilityScores';
import { CharacterHeaderVitals } from './CharacterHeaderVitals';
import { useCombatHP } from './use-combat-hp';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';
import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';
import { calculateAllCharacterStats } from '@/utils/character-calculations';

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
  const character = characterState.character;

  const combatHP = useCombatHP(character?.id);

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
  const sheetHitPoints = useMemo(() => {
    if (!character) return null;
    return getCharacterSheetHitPoints(character);
  }, [character]);

  const stats = useMemo(() => {
    if (!character) return null;

    const charStats = calculateAllCharacterStats(character);

    return {
      armorClass: charStats.armorClass,
      proficiency: charStats.proficiencyBonus,
    };
  }, [character]);

  const handleShortRest = useCallback(() => {
    logger.info('Short rest initiated');
  }, []);

  const handleLongRest = useCallback(() => {
    logger.info('Long rest initiated');
  }, []);

  const backgroundImage = useMemo(
    () => character?.background_image || DEFAULT_BACKGROUND_IMAGE,
    [character?.background_image],
  );

  if (!character || !sheetHitPoints) {
    return (
      <Card className="p-4 text-center text-muted-foreground">
        <p>No character loaded</p>
      </Card>
    );
  }

  const { current: currentHp, maximum: maxHp } = sheetHitPoints;
  const { armorClass, proficiency } = stats!;

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
        <div className="absolute inset-0 shadow-inset-glow-purple opacity-75" />
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
        <CharacterHeaderVitals
          combatHP={combatHP}
          currentHp={currentHp}
          maxHp={maxHp}
          armorClass={armorClass}
          proficiency={proficiency}
        />

        {/* Ability Scores Grid */}
        <CharacterHeaderAbilityScores
          abilityScores={character.abilityScores as Record<string, { score?: number }> | undefined}
        />

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
