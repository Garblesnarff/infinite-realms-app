import { Zap, Target } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import DiceRoller from '@/components/ui/dice-roller';
import { useCharacterStats } from '@/hooks/use-character-stats';
import { SKILLS_MAP } from '@/utils/character-calculations';

interface AbilitiesTabProps {
  character: Character;
  onUpdate: () => void;
}

/**
 * Abilities & Skills tab with clickable rolls
 * Shows ability scores, modifiers, saves, and skills
 * ⚡ Bolt: Wrapped in React.memo and uses useCharacterStats for optimized, centralized D&D calculations.
 */
const AbilitiesTab: React.FC<AbilitiesTabProps> = React.memo(({ character, onUpdate: _onUpdate }) => {
  const stats = useCharacterStats(character);
  const proficiencyBonus = stats?.proficiencyBonus ?? Math.floor((character.level - 1) / 4) + 2;

  const getSkillModifier = (skill: string): number => {
    return stats?.skillModifiers[skill]?.modifier ?? 0;
  };

  const getSaveModifier = (ability: string): number => {
    return stats?.savingThrowModifiers[ability]?.modifier ?? 0;
  };

  const formatModifier = (modifier: number): string => {
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Ability Scores */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            Ability Scores
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {Object.entries(character.abilityScores).map(([ability, data]) => (
            <div key={ability} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <div className="text-2xl font-bold">{data.score}</div>
                  <div className="text-xs text-muted-foreground capitalize">{ability}</div>
                </div>
                <div className="text-lg text-muted-foreground">{formatModifier(data.modifier)}</div>
              </div>
              <DiceRoller
                dice="1d20"
                modifier={data.modifier}
                label={ability.substring(0, 3).toUpperCase()}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Saving Throws */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-red-500" />
            Saving Throws
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(character.abilityScores).map(([ability]) => {
            const isProficient = stats?.savingThrowModifiers[ability]?.proficient ?? false;
            const modifier = getSaveModifier(ability);

            return (
              <div key={ability} className="flex items-center justify-between p-2 border rounded">
                <div className="flex items-center gap-2">
                  {isProficient && <div className="w-2 h-2 bg-primary rounded-full" />}
                  <span className="capitalize font-medium">{ability}</span>
                  <Badge variant="outline" className="text-xs">
                    {formatModifier(modifier)}
                  </Badge>
                </div>
                <DiceRoller
                  dice="1d20"
                  modifier={modifier}
                  label={`${ability.substring(0, 3).toUpperCase()} Save`}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Skills */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Skills</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.entries(SKILLS_MAP).map(([skill, ability]) => {
              const isProficient = stats?.skillModifiers[skill]?.proficient ?? false;
              const modifier = getSkillModifier(skill);

              return (
                <div key={skill} className="flex items-center justify-between p-2 border rounded">
                  <div className="flex items-center gap-2 flex-1">
                    {isProficient && (
                      <div className="w-2 h-2 bg-primary rounded-full flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">{skill}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {ability.substring(0, 3)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {formatModifier(modifier)}
                    </Badge>
                  </div>
                  <div className="ml-2">
                    <DiceRoller dice="1d20" modifier={modifier} label={skill} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Proficiency Legend */}
          <div className="mt-6 pt-4 border-t">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-primary rounded-full" />
                <span>Proficient (+{proficiencyBonus})</span>
              </div>
              <div>
                <span>Proficiency Bonus: +{proficiencyBonus}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export default AbilitiesTab;
