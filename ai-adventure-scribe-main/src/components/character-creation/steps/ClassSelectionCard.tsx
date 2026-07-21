import { Sword, Shield, Heart, Zap, Check, Sparkles, BookOpen } from 'lucide-react';
import React from 'react';

import type { CharacterClass } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

interface ClassSelectionCardProps {
  characterClass: CharacterClass;
  isSelected: boolean;
  isHovered: boolean;
  onSelect: (characterClass: CharacterClass) => void;
  onHoverStart: (classId: string) => void;
  onHoverEnd: () => void;
}

function getClassIcon(classId: string): React.ElementType {
  const iconMap: Record<string, React.ElementType> = {
    fighter: Sword,
    wizard: BookOpen,
    cleric: Sparkles,
    rogue: Zap,
    paladin: Shield,
    barbarian: Heart,
  };
  return iconMap[classId] || Sword;
}

export const ClassSelectionCard: React.FC<ClassSelectionCardProps> = ({
  characterClass,
  isSelected,
  isHovered,
  onSelect,
  onHoverStart,
  onHoverEnd,
}) => {
  const ClassIcon = getClassIcon(characterClass.id);

  return (
    <Card
      className={`group cursor-pointer transition-all duration-300 hover:shadow-2xl border-2 relative overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-infinite-gold ${
        isSelected
          ? 'border-infinite-gold ring-4 ring-infinite-gold/20 shadow-xl scale-[1.02]'
          : 'border-border hover:border-infinite-gold/50 hover:scale-[1.02]'
      }`}
      onClick={() => onSelect(characterClass)}
      onMouseEnter={() => onHoverStart(characterClass.id)}
      onMouseLeave={onHoverEnd}
      role="button"
      tabIndex={0}
      aria-label={`Select ${characterClass.name} class`}
      aria-pressed={isSelected}
      title={`Select ${characterClass.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(characterClass);
        }
      }}
      style={
        characterClass.backgroundImage
          ? {
              backgroundImage: `url(${characterClass.backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {/* Background Overlay */}
      {characterClass.backgroundImage && (
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/50 to-black/30 transition-opacity group-hover:opacity-90"
          style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        />
      )}

      {/* Selected Indicator */}
      {isSelected && (
        <div
          className="absolute top-4 right-4 bg-infinite-gold text-infinite-dark rounded-full p-2 shadow-lg"
          style={{ zIndex: Z_INDEX.CARD_HOVER }}
        >
          <Check className="w-5 h-5" aria-hidden="true" />
        </div>
      )}

      <CardHeader className="relative pb-3" style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${characterClass.backgroundImage ? 'bg-white/20 backdrop-blur-sm' : 'bg-infinite-gold/10'}`}
            >
              <ClassIcon
                className={`w-6 h-6 ${characterClass.backgroundImage ? 'text-white' : 'text-infinite-gold'}`}
                aria-hidden="true"
              />
            </div>
            <CardTitle
              className={`text-2xl font-bold ${characterClass.backgroundImage ? 'text-white drop-shadow-lg' : ''}`}
            >
              {characterClass.name}
            </CardTitle>
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative space-y-4" style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}>
        <p
          className={`text-sm leading-relaxed ${characterClass.backgroundImage ? 'text-gray-100' : 'text-muted-foreground'}`}
        >
          {characterClass.description}
        </p>

        {/* Stats Section */}
        <div
          className={`space-y-3 pt-3 border-t ${characterClass.backgroundImage ? 'border-white/20' : 'border-border'}`}
        >
          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-medium flex items-center gap-2 ${characterClass.backgroundImage ? 'text-gray-200' : ''}`}
            >
              <Heart className="w-4 h-4" aria-hidden="true" />
              Hit Die:
            </span>
            <Badge
              variant={characterClass.backgroundImage ? 'secondary' : 'outline'}
              className={
                characterClass.backgroundImage ? 'bg-white/20 text-white border-white/30' : ''
              }
            >
              d{characterClass.hitDie}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span
              className={`text-sm font-medium flex items-center gap-2 ${characterClass.backgroundImage ? 'text-gray-200' : ''}`}
            >
              <Zap className="w-4 h-4" aria-hidden="true" />
              Primary Ability:
            </span>
            <Badge
              variant={characterClass.backgroundImage ? 'secondary' : 'outline'}
              className={`capitalize ${characterClass.backgroundImage ? 'bg-white/20 text-white border-white/30' : ''}`}
            >
              {String(characterClass.primaryAbility).charAt(0).toUpperCase() +
                String(characterClass.primaryAbility).slice(1)}
            </Badge>
          </div>

          <div>
            <div
              className={`text-sm font-medium mb-2 flex items-center gap-2 ${characterClass.backgroundImage ? 'text-gray-200' : ''}`}
            >
              <Shield className="w-4 h-4" aria-hidden="true" />
              Saving Throws:
            </div>
            <div className="flex flex-wrap gap-1">
              {characterClass.savingThrowProficiencies.map((save, index) => (
                <Badge
                  key={index}
                  variant="secondary"
                  className={`capitalize text-xs ${characterClass.backgroundImage ? 'bg-white/20 text-white border-white/30' : ''}`}
                >
                  {String(save)}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Hover Indicator */}
        {isHovered && !isSelected && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-infinite-gold/0 via-infinite-gold to-infinite-gold/0 animate-pulse" />
        )}
      </CardContent>
    </Card>
  );
};
