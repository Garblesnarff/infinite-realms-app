/**
 * Race Card Components
 * Extracted view mode variants for RaceSelection
 * Supports list, compact, and grid view modes
 */

import { Check, Heart, Star, Users } from 'lucide-react';
import React from 'react';

import type { CharacterRace } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

export interface RaceCardProps {
  race: CharacterRace;
  isSelected: boolean;
  isFavorite: boolean;
  isHovered?: boolean;
  onSelect: (race: CharacterRace) => void;
  onToggleFavorite: (raceId: string) => void;
  onAddToComparison: (race: CharacterRace) => void;
  canAddToComparison: boolean;
  onHover?: (raceId: string | null) => void;
}

/**
 * List view - horizontal card with full details
 */
export const RaceCardListView: React.FC<RaceCardProps> = ({
  race,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onAddToComparison,
  canAddToComparison,
}) => (
  <Card
    className={`cursor-pointer transition-all hover:shadow-lg border-2 relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      isSelected ? 'border-primary bg-primary/5 shadow-lg' : 'border-border hover:border-primary/50'
    }`}
    onClick={() => onSelect(race)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onSelect(race);
    }}
    aria-label={`Select ${race.name} race`}
    title={`Select ${race.name}`}
    aria-pressed={isSelected}
    style={
      race.backgroundImage
        ? {
            backgroundImage: `url(${race.backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : undefined
    }
  >
    {race.backgroundImage && (
      <div className="absolute inset-0 bg-black/60" style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }} />
    )}
    <CardContent
      className={`p-4 relative ${race.backgroundImage ? 'text-white' : ''}`}
      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <Users
              className={`w-5 h-5 flex-shrink-0 ${race.backgroundImage ? 'text-yellow-400' : 'text-primary'}`}
              aria-hidden="true"
            />
            <h3 className="text-xl font-bold truncate">{race.name}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {Object.entries(race.abilityScoreIncrease).map(([ability, bonus]) => (
              <Badge
                key={ability}
                variant="secondary"
                className={`text-xs ${race.backgroundImage ? 'bg-black/60 text-white border-white/20 backdrop-blur-sm' : ''}`}
                title={`${ability} increase`}
              >
                {ability.substring(0, 3)} +{bonus}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(race.id);
            }}
            className="p-1"
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-pressed={isFavorite}
          >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onAddToComparison(race);
            }}
            className="p-1"
            disabled={!canAddToComparison}
            aria-label="Add to comparison"
            title="Add to comparison"
          >
            <Star className="w-4 h-4" aria-hidden="true" />
          </Button>
          {isSelected && (
            <div className="bg-primary text-primary-foreground rounded-full p-1">
              <Check className="w-4 h-4" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
      <p
        className={`text-sm mt-2 line-clamp-2 ${race.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
      >
        {race.description}
      </p>
      <div
        className={`flex items-center gap-4 mt-2 text-xs ${race.backgroundImage ? 'text-gray-300' : 'text-muted-foreground'}`}
      >
        <span>Speed: {race.speed}ft</span>
        <span>{race.languages.length} languages</span>
        {race.subraces && race.subraces.length > 0 && <span>{race.subraces.length} subraces</span>}
      </div>
    </CardContent>
  </Card>
);

/**
 * Compact view - medium-sized card for dense display
 */
export const RaceCardCompactView: React.FC<RaceCardProps> = ({ race, isSelected, onSelect }) => (
  <Card
    className={`cursor-pointer transition-all duration-300 hover:shadow-xl hover:scale-105 border-2 relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      isSelected
        ? 'border-primary bg-primary/5 shadow-lg ring-4 ring-primary/20'
        : 'border-border hover:border-primary/50'
    }`}
    onClick={() => onSelect(race)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onSelect(race);
    }}
    aria-label={`Select ${race.name} race`}
    title={`Select ${race.name}`}
    aria-pressed={isSelected}
    style={
      race.backgroundImage
        ? {
            backgroundImage: `url(${race.backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : undefined
    }
  >
    {race.backgroundImage && (
      <div className="absolute inset-0 bg-black/60" style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }} />
    )}
    <div className="p-4">
      <div
        className={`flex items-center justify-between mb-3 relative ${race.backgroundImage ? 'text-white' : ''}`}
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        <div className="flex items-center gap-2">
          <Users
            className={`w-5 h-5 ${race.backgroundImage ? 'text-yellow-400' : 'text-primary'}`}
            aria-hidden="true"
          />
          <h3 className="font-bold text-lg">{race.name}</h3>
        </div>
        {isSelected && (
          <div className="bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
            <Check className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
      </div>
      <div
        className="flex flex-wrap gap-1.5 mb-3 relative"
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        {Object.entries(race.abilityScoreIncrease).map(([ability, bonus]) => (
          <Badge
            key={ability}
            variant="secondary"
            className={`text-xs font-semibold ${race.backgroundImage ? 'bg-black/60 text-white border-white/20 backdrop-blur-sm' : ''}`}
            title={`${ability} increase`}
          >
            +{bonus} {ability.substring(0, 3)}
          </Badge>
        ))}
      </div>
      <p
        className={`text-sm line-clamp-2 relative leading-relaxed ${race.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        {race.description}
      </p>
      {race.subraces && race.subraces.length > 0 && (
        <div
          className={`text-xs text-center mt-3 pt-2 border-t relative ${race.backgroundImage ? 'text-gray-300 border-gray-400' : 'text-muted-foreground border-border'}`}
          style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
        >
          {race.subraces.length} subrace{race.subraces.length > 1 ? 's' : ''} available
        </div>
      )}
    </div>
  </Card>
);

/**
 * Grid view - large square card with image background
 */
export const RaceCardGridView: React.FC<RaceCardProps> = ({
  race,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
  onAddToComparison,
  canAddToComparison,
  onHover,
}) => (
  <Card
    className={`race-card group cursor-pointer transition-all hover:shadow-xl border-2 relative overflow-hidden aspect-square outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      isSelected ? 'border-primary shadow-lg' : 'border-border/30 hover:border-infinite-purple/50'
    }`}
    aria-label={`Select ${race.name} race`}
    title={`Select ${race.name}`}
    aria-pressed={isSelected}
    style={{
      padding: 0,
      ...(race.backgroundImage
        ? {
            backgroundImage: `url(${race.backgroundImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }
        : {}),
    }}
    onClick={() => onSelect(race)}
    onMouseEnter={() => onHover?.(race.id)}
    onMouseLeave={() => onHover?.(null)}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') onSelect(race);
    }}
  >
    {/* Edge blur overlay */}
    <div
      className="absolute inset-0"
      style={{ boxShadow: 'inset 0 0 60px 20px rgba(0, 0, 0, 0.3)' }}
    />

    {/* Top-right indicators */}
    <div
      className="absolute top-3 right-3 flex items-center gap-2"
      style={{ zIndex: Z_INDEX.CARD_HOVER }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(race.id);
        }}
        className="p-1 bg-white/10 hover:bg-white/20"
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={isFavorite}
        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      >
            <Heart className={`w-4 h-4 ${isFavorite ? 'fill-red-500 text-red-500' : 'text-white'}`} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onAddToComparison(race);
        }}
        className="p-1 bg-white/10 hover:bg-white/20"
        disabled={!canAddToComparison}
        aria-label="Add to comparison"
        title="Add to comparison"
      >
            <Star className="w-4 h-4 text-white" aria-hidden="true" />
      </Button>
      {isSelected && (
        <div className="bg-primary text-primary-foreground rounded-full p-1">
          <Check className="w-4 h-4" aria-hidden="true" />
        </div>
      )}
    </div>

    {/* Bottom content overlay */}
    <div
      className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
      style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Users className="w-5 h-5 text-yellow-400" aria-hidden="true" />
        <h3 className="font-bold text-lg text-white">{race.name}</h3>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {Object.entries(race.abilityScoreIncrease).map(([ability, bonus]) => (
          <Badge
            key={ability}
            variant="secondary"
            className="text-xs font-semibold bg-black/60 text-white border-white/20 backdrop-blur-sm"
            title={`${ability} increase`}
          >
            +{bonus} {ability.substring(0, 3)}
          </Badge>
        ))}
      </div>
      <p className="text-sm text-gray-200 line-clamp-2">{race.description}</p>
      {race.subraces && race.subraces.length > 0 && (
        <div className="text-xs text-gray-300 mt-2">
          {race.subraces.length} subrace{race.subraces.length > 1 ? 's' : ''} available
        </div>
      )}
    </div>
  </Card>
);
