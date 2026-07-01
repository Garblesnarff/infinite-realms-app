/* eslint-disable max-lines -- pre-existing length; restyle-only change. Tracked for decomposition. */
import { Sword, Shield, Heart, Brain, Users, Eye, Sparkles, Crown, Star } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCharacter } from '@/contexts/CharacterContext';

/**
 * Real-time character preview component
 * Shows character progression and current stats as choices are made
 */
const CharacterPreview: React.FC = () => {
  const { state } = useCharacter();
  const character = state.character;

  if (!character) {
    return (
      <Card className="glass-strong rounded-2xl border-2 border-dashed border-infinite-purple/25">
        <div className="p-6 text-center space-y-4">
          <div className="w-24 h-24 mx-auto bg-gradient-to-br from-infinite-purple/20 to-infinite-gold/20 rounded-full flex items-center justify-center">
            <Sparkles className="w-12 h-12 text-infinite-purple" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Character Preview</h3>
            <p className="text-sm text-muted-foreground">
              Your character will appear here as you make choices
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const getAbilityIcon = (ability: string) => {
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
  };

  const getAlignmentColor = (alignment: string) => {
    if (alignment?.includes('Good'))
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    if (alignment?.includes('Evil')) return 'bg-red-500/15 text-red-400 border-red-500/30';
    if (alignment?.includes('Lawful'))
      return 'bg-infinite-teal/15 text-infinite-teal border-infinite-teal/30';
    if (alignment?.includes('Chaotic'))
      return 'bg-infinite-purple/15 text-infinite-purple border-infinite-purple/30';
    return 'bg-white/10 text-muted-foreground border-white/10';
  };

  const totalLevel = character.level || 1;
  const proficiencyBonus = Math.ceil(totalLevel / 4) + 1;

  return (
    <Card className="glass-strong rounded-2xl hover-lift border-2 border-infinite-purple/20">
      <div className="p-6 space-y-6">
        {/* Character Header */}
        <div className="text-center space-y-3">
          <div className="relative">
            <div className="w-20 h-20 mx-auto bg-gradient-to-br from-infinite-purple to-infinite-gold rounded-full flex items-center justify-center border-4 border-infinite-gold/40 shadow-lg">
              {character.avatar_url ? (
                <img
                  src={character.avatar_url}
                  alt={character.name || 'Character'}
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <Sparkles className="w-10 h-10 text-white" />
              )}
            </div>
            {character.name && (
              <Badge className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 bg-infinite-dark-lighter text-infinite-gold border-2 border-infinite-purple/30">
                Level {totalLevel}
              </Badge>
            )}
          </div>

          <div>
            <h3 className="ir-display font-semibold text-xl text-foreground">
              {character.name || 'Unnamed Hero'}
            </h3>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {character.race && (
                <Badge
                  variant="secondary"
                  className="bg-infinite-teal/15 text-infinite-teal border border-infinite-teal/30"
                >
                  {character.subrace
                    ? `${character.subrace.name} (${character.race.name})`
                    : character.race.name}
                </Badge>
              )}
              {character.class && (
                <Badge
                  variant="secondary"
                  className="bg-infinite-purple/15 text-infinite-purple border border-infinite-purple/30"
                >
                  {character.class.name}
                </Badge>
              )}
              {character.background && (
                <Badge
                  variant="secondary"
                  className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                >
                  {character.background.name}
                </Badge>
              )}
            </div>
          </div>
        </div>

        <Separator className="bg-white/10" />

        {/* Ability Scores */}
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

        {/* Combat Stats */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
            <Sword className="w-4 h-4 mr-2" />
            Combat Stats
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center p-2 bg-white/[0.04] rounded-lg border border-white/10">
              <div className="text-lg font-bold text-infinite-teal">
                {character.class?.hitDie ? character.class.hitDie : 8}
              </div>
              <div className="text-xs text-muted-foreground">Hit Die</div>
            </div>
            <div className="text-center p-2 bg-white/[0.04] rounded-lg border border-white/10">
              <div className="text-lg font-bold text-emerald-400">+{proficiencyBonus}</div>
              <div className="text-xs text-muted-foreground">Proficiency</div>
            </div>
          </div>
        </div>

        {/* Personality & Alignment */}
        {(character.alignment || character.personalityTraits?.length) && (
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
              <Crown className="w-4 h-4 mr-2" />
              Personality
            </h4>
            <div className="space-y-2">
              {character.alignment && (
                <Badge
                  className={`w-full justify-center ${getAlignmentColor(character.alignment)}`}
                >
                  {character.alignment}
                </Badge>
              )}
              {character.personalityTraits?.slice(0, 2).map((trait, index) => (
                <div
                  key={index}
                  className="text-xs p-2 bg-white/[0.04] rounded border border-white/10"
                >
                  {trait}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Proficiencies Preview */}
        {(character.skillProficiencies?.length || character.languages?.length) && (
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground flex items-center">
              <Star className="w-4 h-4 mr-2" />
              Proficiencies
            </h4>
            <div className="space-y-2">
              {character.skillProficiencies?.length && (
                <div className="text-xs">
                  <span className="font-medium">Skills:</span>{' '}
                  {character.skillProficiencies.slice(0, 3).join(', ')}
                  {character.skillProficiencies.length > 3 && '...'}
                </div>
              )}
              {character.languages?.length && (
                <div className="text-xs">
                  <span className="font-medium">Languages:</span>{' '}
                  {character.languages.slice(0, 3).join(', ')}
                  {character.languages.length > 3 && '...'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Character Description Preview */}
        {character.description && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-muted-foreground">Description</h4>
            <p className="text-xs text-muted-foreground line-clamp-3 bg-white/[0.04] p-2 rounded border border-white/10">
              {character.description}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};

export default CharacterPreview;
