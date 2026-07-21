import React from 'react';

import { getClassIcon } from './StarterCharacterCard';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Get ability modifier from score
 */
export function getModifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

/**
 * Character Details Panel
 */
export interface StarterCharacterDetailsProps {
  template: StarterCharacterTemplate;
}

export const StarterCharacterDetails: React.FC<StarterCharacterDetailsProps> = ({ template }) => {
  const { abilityScores, personality } = template;

  return (
    <TooltipProvider>
      <div className="bg-card/70 rounded-xl p-6 border border-border">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-infinite-purple/30 to-infinite-gold/30 flex items-center justify-center border-2 border-infinite-gold/50">
            {template.portraitUrl ? (
              <img
                src={template.portraitUrl}
                alt={template.name}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <div className="text-2xl text-infinite-gold">{getClassIcon(template.class)}</div>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{template.name}</h2>
            <p className="text-infinite-gold">
              {template.race}
              {template.subrace && ` (${template.subrace})`} {template.class}
            </p>
            {template.background && (
              <p className="text-sm text-muted-foreground">{template.background}</p>
            )}
          </div>
        </div>

        {/* Ability Scores */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Ability Scores
          </h3>
          <div className="grid grid-cols-6 gap-2">
            {Object.entries(abilityScores).map(([ability, score]) => {
              const modifier = getModifier(score);
              const label = `${ability}: ${score}, modifier ${modifier}`;
              return (
                <Tooltip key={ability} delayDuration={300}>
                  <TooltipTrigger asChild>
                    <div
                      role="group"
                      aria-label={label}
                      className="bg-secondary/20 rounded-lg p-2 text-center border border-border cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple"
                      tabIndex={0}
                    >
                      <p className="text-xs text-muted-foreground uppercase" aria-hidden="true">
                        {ability.slice(0, 3)}
                      </p>
                      <p className="text-lg font-bold text-foreground" aria-hidden="true">
                        {score}
                      </p>
                      <p className="text-xs text-infinite-gold" aria-hidden="true">
                        {modifier}
                      </p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Backstory */}
        {template.adaptedBackstory && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Backstory
            </h3>
            <p className="text-foreground/90 text-sm leading-relaxed">
              {template.adaptedBackstory}
            </p>
          </div>
        )}

        {/* Campaign Hook */}
        {template.campaignHook && (
          <div className="mb-6 bg-infinite-gold/10 rounded-lg p-4 border border-infinite-gold/20">
            <h3 className="text-sm font-semibold text-infinite-gold mb-2">Why You're Here</h3>
            <p className="text-foreground/90 text-sm italic">{template.campaignHook}</p>
          </div>
        )}

        {/* Personality */}
        {personality.traits && personality.traits.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Personality
            </h3>
            <div className="space-y-2">
              {personality.traits.map((trait, i) => (
                <p key={i} className="text-sm text-foreground/90">
                  • {trait}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* Skills & Equipment */}
        <div className="grid grid-cols-2 gap-4">
          {template.skills.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Skills
              </h3>
              <div className="flex flex-wrap gap-1">
                {template.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-xs">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {template.languages.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Languages
              </h3>
              <div className="flex flex-wrap gap-1">
                {template.languages.map((lang) => (
                  <Badge key={lang} variant="outline" className="text-xs">
                    {lang}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};
