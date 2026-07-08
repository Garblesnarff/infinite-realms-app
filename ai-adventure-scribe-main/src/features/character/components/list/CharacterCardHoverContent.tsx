import { Play, Trash2, Sword, Shield, Star } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Z_INDEX } from '@/constants/z-index';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';

interface CharacterCardHoverContentProps {
  character: Partial<Character> & Required<Pick<Character, 'id' | 'name'>>;
  isHovered: boolean;
  imageLoading: boolean;
  onPlay: (e: React.MouseEvent) => void;
  onViewDetails: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

/**
 * CharacterCardHoverContent displays detailed character information in a popup
 * when the CharacterCard is hovered.
 */
const CharacterCardHoverContent = ({
  character,
  isHovered,
  imageLoading,
  onPlay,
  onViewDetails,
  onDelete,
}: CharacterCardHoverContentProps): JSX.Element => {
  // Calculate ability score modifier
  const getModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  // Format modifier with + or - sign
  const formatModifier = (score: number): string => {
    const modifier = getModifier(score);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  // Calculate proficiency bonus based on character level
  const getProficiencyBonus = (level?: number): number => {
    return calculateProficiencyBonus(level || 1);
  };

  return (
    <div
      className={`hover-popup ${isHovered ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'} absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-300 ease-out`}
      style={isHovered ? { zIndex: Z_INDEX.CARD_HOVER } : undefined}
    >
      <div className="ir-panel backdrop-blur-sm p-4 max-w-xs">
        {/* Avatar Display */}
        {character.avatar_url && (
          <div className="flex justify-center mb-3">
            <img
              src={character.avatar_url}
              alt={`${character.name} avatar`}
              className="w-20 h-20 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 hover:scale-110 hover:border-infinite-purple hover:shadow-infinite-purple/70"
            />
          </div>
        )}

        <div className="text-xl font-bold text-foreground mb-2 leading-tight break-words">
          {imageLoading ? <Skeleton className="h-6 w-48" /> : character.name}
        </div>

        {imageLoading ? (
          <Skeleton className="h-4 w-full" />
        ) : (
          <>
            {/* Race/Class Info */}
            <div className="flex items-center gap-3 text-sm text-foreground mb-3">
              {character.race && (
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3 text-infinite-purple" aria-hidden="true" />
                  {character.subrace
                    ? `${typeof character.subrace === 'string' ? character.subrace : character.subrace.name} (${typeof character.race === 'string' ? character.race : character.race.name})`
                    : typeof character.race === 'string'
                      ? character.race
                      : character.race.name}
                </span>
              )}
              {character.class && (
                <span className="flex items-center gap-1">
                  <Sword className="w-3 h-3 text-infinite-gold" aria-hidden="true" />
                  {typeof character.class === 'string' ? character.class : character.class.name}
                </span>
              )}
              {character.level && (
                <span className="flex items-center gap-1">
                  <Star className="w-3 h-3 text-infinite-teal" aria-hidden="true" />
                  Level {character.level}
                </span>
              )}
            </div>

            {/* Ability Scores Grid */}
            <div className="mb-3">
              <div className="text-sm font-semibold text-foreground mb-2">Ability Scores</div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">STR</span>
                  <span>
                    {character.character_stats?.strength || 10} (
                    {formatModifier(character.character_stats?.strength || 10)})
                  </span>
                </div>
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">INT</span>
                  <span>
                    {character.character_stats?.intelligence || 10} (
                    {formatModifier(character.character_stats?.intelligence || 10)})
                  </span>
                </div>
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">DEX</span>
                  <span>
                    {character.character_stats?.dexterity || 10} (
                    {formatModifier(character.character_stats?.dexterity || 10)})
                  </span>
                </div>
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">WIS</span>
                  <span>
                    {character.character_stats?.wisdom || 10} (
                    {formatModifier(character.character_stats?.wisdom || 10)})
                  </span>
                </div>
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">CON</span>
                  <span>
                    {character.character_stats?.constitution || 10} (
                    {formatModifier(character.character_stats?.constitution || 10)})
                  </span>
                </div>
                <div className="flex justify-between items-center bg-secondary/20 px-2 py-1 rounded">
                  <span className="font-medium">CHA</span>
                  <span>
                    {character.character_stats?.charisma || 10} (
                    {formatModifier(character.character_stats?.charisma || 10)})
                  </span>
                </div>
              </div>
            </div>

            {/* Combat Stats */}
            <div className="flex items-center gap-4 text-xs text-foreground mb-4 bg-accent/10 px-3 py-2 rounded">
              {character.character_stats?.max_hit_points && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">HP:</span>{' '}
                  {character.character_stats.current_hit_points ||
                    character.character_stats.max_hit_points}
                  /{character.character_stats.max_hit_points}
                </span>
              )}
              {character.character_stats?.armor_class && (
                <span className="flex items-center gap-1">
                  <span className="font-medium">AC:</span> {character.character_stats.armor_class}
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="font-medium">Prof:</span> +{getProficiencyBonus(character.level)}
              </span>
            </div>
          </>
        )}

        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            className="bg-infinite-gold text-infinite-dark flex items-center gap-2 hover:bg-infinite-purple"
            aria-label="Play as this character"
            title="Play as this character"
            onClick={onPlay}
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            Play
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-infinite-teal text-infinite-teal hover:bg-infinite-teal hover:text-infinite-dark"
            aria-label="View character details"
            title="View character details"
            onClick={onViewDetails}
          >
            View Details
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-infinite-dark/20"
            onClick={onDelete}
            aria-label="Delete character"
            title="Delete character"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(CharacterCardHoverContent);
