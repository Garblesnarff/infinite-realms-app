import { Sword, Shield, Heart, Brain, Users, Eye, Crown, Star } from 'lucide-react';
import React from 'react';

import { type AbilityScores, type Character } from '@/types/character';
import { applyRacialBonusesToAbilityScores } from '@/utils/racialAbilityBonuses';

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
  // Show post-racial scores (#389): the wizard holds base scores, but the
  // saved character gets racial bonuses. The preview must match the save.
  const race = typeof character.race === 'object' ? character.race : null;
  const subrace = typeof character.subrace === 'object' ? character.subrace : null;
  const emptyScores = {} as AbilityScores;
  const displayScores: AbilityScores =
    race || subrace
      ? applyRacialBonusesToAbilityScores(
          character.abilityScores ?? emptyScores,
          race,
          subrace,
          character.racialAbilityChoices,
        )
      : (character.abilityScores ?? emptyScores);

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
        <Shield className="w-4 h-4 mr-2" />
        Ability Scores
      </h4>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(displayScores).map(([ability, data]) => (
          <div
            key={ability}
            className="flex items-center justify-between p-2 bg-card rounded-lg border border-border"
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
