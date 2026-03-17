import { Check, Users, Zap } from 'lucide-react';
import React from 'react';

import type { Subrace } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

interface SubraceCardProps {
  subrace: Subrace;
  isSelected: boolean;
  onSelect: (subrace: Subrace) => void;
}

export const SubraceCard: React.FC<SubraceCardProps> = ({ subrace, isSelected, onSelect }) => {
  return (
    <Card
      key={subrace.id}
      className={`cursor-pointer transition-all hover:shadow-lg border-2 relative overflow-hidden ${
        isSelected
          ? 'border-primary bg-primary/5 shadow-lg'
          : 'border-border hover:border-primary/50'
      }`}
      onClick={() => onSelect(subrace)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect(subrace);
        }
      }}
      aria-label={`Select ${subrace.name} subrace`}
      title={`Select ${subrace.name}`}
      aria-pressed={isSelected}
      style={
        subrace.backgroundImage
          ? {
              backgroundImage: `url(${subrace.backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }
          : undefined
      }
    >
      {subrace.backgroundImage && (
        <div
          className="absolute inset-0 bg-black/50"
          style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        />
      )}
      {isSelected && (
        <div
          className="absolute top-3 right-3"
          style={{ zIndex: Z_INDEX.CARD_HOVER }}
        >
          <div className="bg-primary text-primary-foreground rounded-full p-1">
            <Check className="w-4 h-4" />
          </div>
        </div>
      )}

      <CardHeader className="relative" style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}>
        <div className="flex items-center gap-2">
          <Users
            className={`w-5 h-5 ${subrace.backgroundImage ? 'text-yellow-400' : 'text-primary'}`}
          />
          <h3
            className={`text-2xl font-bold ${subrace.backgroundImage ? 'text-white' : ''}`}
          >
            {subrace.name}
          </h3>
        </div>
      </CardHeader>

      <CardContent
        className="space-y-4 relative"
        style={{ zIndex: Z_INDEX.OVERLAY_EFFECT }}
      >
        <p
          className={`${subrace.backgroundImage ? 'text-gray-200' : 'text-muted-foreground'}`}
        >
          {subrace.description}
        </p>

        {/* Ability Score Increases */}
        {Object.keys(subrace.abilityScoreIncrease).length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap
                className={`w-4 h-4 ${subrace.backgroundImage ? 'text-yellow-400' : 'text-orange-500'}`}
              />
              <h4
                className={`font-semibold ${subrace.backgroundImage ? 'text-white drop-shadow' : ''}`}
              >
                Subrace Ability Increases
              </h4>
            </div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(subrace.abilityScoreIncrease).map(
                ([ability, bonus]) => (
                  <Badge
                    key={ability}
                    variant="secondary"
                    className={`capitalize ${subrace.backgroundImage ? 'bg-black/60 text-white border-white/20 backdrop-blur-sm' : ''}`}
                    title={`${ability} increase`}
                  >
                    {ability.substring(0, 3)} +{bonus}
                  </Badge>
                ),
              )}
            </div>
          </div>
        )}

        {/* Speed Override */}
        {subrace.speed && (
          <div>
            <p className="text-sm">
              <span className="font-medium">Speed:</span> {subrace.speed} feet
            </p>
          </div>
        )}

        {/* Subrace Traits */}
        <div>
          <h4
            className={`font-semibold mb-2 ${subrace.backgroundImage ? 'text-white drop-shadow' : ''}`}
          >
            Subrace Traits
          </h4>
          <div className="space-y-1">
            {subrace.traits.map((trait: string, index: number) => (
              <div
                key={index}
                className={`text-sm p-2 rounded ${subrace.backgroundImage ? 'bg-white/20 text-white' : 'bg-muted/30'}`}
              >
                <span className="font-medium">{trait.split(':')[0]}:</span>
                <span
                  className={`${subrace.backgroundImage ? 'text-gray-100' : 'text-muted-foreground'} ml-1`}
                >
                  {trait.split(':')[1] || trait}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
