import { Play, Loader2 } from 'lucide-react';
import React from 'react';

import type { StarterTemplate } from '@/features/campaign/hooks/use-character-selection';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';

interface StarterTemplateCardProps {
  template: StarterTemplate;
  isCreating: boolean;
  onSelect: (template: StarterTemplate) => void;
  getModifier: (score?: number) => string;
}

/**
 * Component for rendering a starter template card in the character selection modal.
 * Extracted from CharacterSelectionModal.
 */
export const StarterTemplateCard: React.FC<StarterTemplateCardProps> = ({
  template,
  isCreating,
  onSelect,
  getModifier,
}) => {
  const abilityScores = template.ability_scores || {};
  const cardTitle = `Select character: ${template.name}, Level ${template.level} ${template.race} ${template.class}`;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => !isCreating && onSelect(template)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!isCreating) onSelect(template);
        }
      }}
      aria-label={cardTitle}
      title={cardTitle}
      className="group cursor-pointer hover:shadow-2xl hover:shadow-infinite-purple/40 transition-all duration-500 overflow-hidden border-2 border-border/60 hover:border-infinite-gold/90 hover:scale-[1.02] relative bg-white focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:outline-none"
    >
      {/* Glow effect on hover */}
      <div
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ zIndex: Z_INDEX.BACKGROUND_LAYER }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 shadow-inset-glow-purple" />
      </div>

      <div
        className="relative h-32 bg-cover bg-center transition-all duration-700 ease-out group-hover:scale-105 group-hover:brightness-110"
        style={{
          backgroundImage: template.portrait_url
            ? `url(${template.portrait_url})`
            : `url(${new URL('/card-background.jpeg', import.meta.url).href})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/60 via-white/80 to-white/95" />
        {template.portrait_url && (
          <div className="absolute -bottom-8 left-4" style={{ zIndex: Z_INDEX.DROPDOWN }}>
            <img
              src={template.portrait_url}
              alt=""
              className="w-16 h-16 rounded-full object-cover border-4 border-infinite-gold/80 shadow-lg shadow-infinite-gold/50 transition-all duration-300 group-hover:scale-110 group-hover:border-infinite-purple group-hover:shadow-infinite-purple/70"
            />
          </div>
        )}
      </div>
      <CardContent className="p-4 pt-10 bg-white">
        <div className="space-y-3">
          <div>
            <h3 className="font-semibold text-lg text-foreground">{template.name}</h3>
            <p className="text-sm text-muted-foreground">
              Level {template.level} {template.race} {template.class}
            </p>
            {template.tagline && (
              <p className="text-xs text-muted-foreground italic mt-1">{template.tagline}</p>
            )}
          </div>

          {/* Ability Scores Grid */}
          <div
            className="grid grid-cols-3 gap-2 text-xs"
            role="group"
            aria-label="Ability modifiers"
          >
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Strength modifier: ${getModifier(abilityScores.strength)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                STR
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.strength)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Dexterity modifier: ${getModifier(abilityScores.dexterity)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                DEX
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.dexterity)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Constitution modifier: ${getModifier(abilityScores.constitution)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                CON
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.constitution)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Intelligence modifier: ${getModifier(abilityScores.intelligence)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                INT
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.intelligence)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Wisdom modifier: ${getModifier(abilityScores.wisdom)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                WIS
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.wisdom)}
              </span>
            </div>
            <div
              className="flex flex-col items-center p-2 bg-gray-50 rounded border border-gray-200 shadow-sm"
              aria-label={`Charisma modifier: ${getModifier(abilityScores.charisma)}`}
            >
              <span className="font-semibold text-muted-foreground" aria-hidden="true">
                CHA
              </span>
              <span className="text-lg font-bold text-foreground" aria-hidden="true">
                {getModifier(abilityScores.charisma)}
              </span>
            </div>
          </div>

          <Button className="w-full" disabled={isCreating} tabIndex={-1} aria-hidden="true">
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Start Adventure
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
