import React from 'react';

import { getClassIcon } from './StarterCharacterCard';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

import { Badge } from '@/components/ui/badge';

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
    <div className="bg-gray-800/70 rounded-xl p-6 border border-gray-700">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-600/30 to-amber-600/30 flex items-center justify-center border-2 border-purple-500/50">
          {template.portraitUrl ? (
            <img
              src={template.portraitUrl}
              alt={template.name}
              className="w-full h-full rounded-full object-cover"
            />
          ) : (
            <div className="text-2xl text-purple-300">{getClassIcon(template.class)}</div>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{template.name}</h2>
          <p className="text-purple-300">
            {template.race}
            {template.subrace && ` (${template.subrace})`} {template.class}
          </p>
          {template.background && <p className="text-sm text-gray-400">{template.background}</p>}
        </div>
      </div>

      {/* Ability Scores */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Ability Scores
        </h3>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(abilityScores).map(([ability, score]) => {
            const modifier = getModifier(score);
            const label = `${ability}: ${score}, modifier ${modifier}`;
            return (
              <div
                key={ability}
                role="group"
                aria-label={label}
                title={label}
                className="bg-gray-900/50 rounded-lg p-2 text-center border border-gray-700"
              >
                <p className="text-xs text-gray-400 uppercase" aria-hidden="true">
                  {ability.slice(0, 3)}
                </p>
                <p className="text-lg font-bold text-white" aria-hidden="true">
                  {score}
                </p>
                <p className="text-xs text-purple-300" aria-hidden="true">
                  {modifier}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Backstory */}
      {template.adaptedBackstory && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Backstory
          </h3>
          <p className="text-gray-300 text-sm leading-relaxed">{template.adaptedBackstory}</p>
        </div>
      )}

      {/* Campaign Hook */}
      {template.campaignHook && (
        <div className="mb-6 bg-purple-900/20 rounded-lg p-4 border border-purple-500/20">
          <h3 className="text-sm font-semibold text-purple-300 mb-2">Why You're Here</h3>
          <p className="text-gray-300 text-sm italic">{template.campaignHook}</p>
        </div>
      )}

      {/* Personality */}
      {personality.traits && personality.traits.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Personality
          </h3>
          <div className="space-y-2">
            {personality.traits.map((trait, i) => (
              <p key={i} className="text-sm text-gray-300">
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
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
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
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
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
  );
};
