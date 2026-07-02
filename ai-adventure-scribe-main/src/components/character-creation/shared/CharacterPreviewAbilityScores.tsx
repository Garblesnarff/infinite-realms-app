import { Sword, Shield, Heart, Brain, Users, Eye, Crown, Star } from 'lucide-react';
import React from 'react';

import { type Character } from '@/types/character';

interface CharacterPreviewAbilityScoresProps {
  character: Character;
}

function getAbilityIcon(ability: string) {
  switch (ability.toLowerCase()) {
    case 'strength':
      return <Sword className="w-4 h-4" />;
    case 'dexterity':
      return <Eye className="w-4 h-4" />;
    case 'constitution':
      return <Heart className="w-4 h-4" />;
    case 'intelligence':
      return <Brain className="w-4 h-4" />;
    case 'wisdom':
      return <Crown className="w-4 h-4" />;
    case 'charisma':
      return <Users className="w-4 h-4" />;
    default:
      return <Star className="w-4 h-4" />;
  }
}

export const CharacterPreviewAbilityScores: React.FC<CharacterPreviewAbilityScoresProps> = ({
  character,
}) => {
  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
        <Shield className="w-4 h-4 mr-2" />
        Ability Scores
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(character.abilityScores || {}).map(([ability, data]) => (
          <div
            key={ability}
            className="flex items-center justify-between p-2 bg-white/[0.04] rounded-lg border border-white/10"
          >
            <div className="flex items-center space-x-2">
              {getAbilityIcon(ability)}
              <span className="text-xs font-medium capitalize">{ability}</span>
            </div>
            <div className="text-right">
              <div className="font-bold text-sm">{data.score}</div>
              <div
                className={`text-xs ${data.modifier >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {data.modifier >= 0 ? '+' : ''}
                {data.modifier}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
