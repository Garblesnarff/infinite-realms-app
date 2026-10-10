import { Star, Users, Zap, BookOpen } from 'lucide-react';
import React from 'react';

import { FeatureCategoryCard } from './FeatureCategoryCard';
import { FeaturesProficienciesCard } from './FeaturesProficienciesCard';
import ClassFeatureTracker from '../sections/ClassFeatureTracker';
import FightingStylesDisplay from '../sections/FightingStylesDisplay';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { getAllClassFeaturesUpToLevel } from '@/data/levelProgression';

interface FeaturesTabProps {
  character: Character;
  // #2701 / #224: persists the edited character and resolves true when the
  // write landed. ClassFeatureTracker toasts only then.
  onUpdate: CharacterSheetUpdateFn;
}

interface Feature {
  name: string;
  source: 'race' | 'class' | 'background' | 'feat';
  description: string;
  level?: number;
  uses?: {
    total: number;
    used: number;
    recharge: 'short' | 'long' | 'dawn' | 'manual';
  };
}

/**
 * Features & Traits tab showing racial traits, class features, and special abilities
 */
const FeaturesTab: React.FC<FeaturesTabProps> = ({ character, onUpdate }) => {
  const className = character.class?.name ?? '';
  const features: Feature[] = [
    ...(character.race?.traits ?? []).map((trait) => ({
      name: trait,
      source: 'race' as const,
      description: trait,
    })),
    ...getAllClassFeaturesUpToLevel(className, character.level ?? 1).map((feature) => ({
      name: feature.featureName,
      source: 'class' as const,
      level: feature.level,
      description: feature.description,
    })),
    ...(character.subclass?.features ?? [])
      .filter((feature) => feature.level <= (character.level ?? 1))
      .map((feature) => ({
        name: feature.name,
        source: 'class' as const,
        level: feature.level,
        description: feature.description,
      })),
    ...(character.background
      ? [
          {
            name: character.background.feature.name,
            source: 'background' as const,
            description: character.background.feature.description,
          },
        ]
      : []),
  ];

  const _getFeatureIcon = (source: string) => {
    switch (source) {
      case 'race':
        return <Users className="w-4 h-4 text-emerald-500" />;
      case 'class':
        return <Star className="w-4 h-4 text-infinite-teal" />;
      case 'background':
        return <BookOpen className="w-4 h-4 text-infinite-purple" />;
      case 'feat':
        return <Zap className="w-4 h-4 text-orange-600" />;
      default:
        return <Star className="w-4 h-4" />;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'race':
        return 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30';
      case 'class':
        return 'bg-infinite-teal/15 text-infinite-teal border border-infinite-teal/30';
      case 'background':
        return 'bg-infinite-purple/15 text-infinite-purple border border-infinite-purple/30';
      case 'feat':
        return 'bg-orange-500/15 text-orange-400 border border-orange-500/30';
      default:
        return 'bg-muted text-muted-foreground border border-border';
    }
  };

  // Group features by source
  const featuresBySource = {
    race: features.filter((f) => f.source === 'race'),
    class: features.filter((f) => f.source === 'class'),
    background: features.filter((f) => f.source === 'background'),
    feat: features.filter((f) => f.source === 'feat'),
  };

  return (
    <div className="space-y-6">
      {/* Class Feature Tracker */}
      <ClassFeatureTracker character={character} onUpdate={onUpdate} />

      {/* Fighting Styles */}
      <FightingStylesDisplay character={character} />

      {/* Racial Traits */}
      <FeatureCategoryCard
        title="Racial Traits"
        icon={<Users className="w-5 h-5 text-emerald-500" />}
        borderColorClass="border-emerald-500"
        badgeColorClass={getSourceColor('race')}
        features={featuresBySource.race}
        badgeLabel={() => character.race?.name}
      />

      {/* Class Features */}
      <FeatureCategoryCard
        title="Class Features"
        icon={<Star className="w-5 h-5 text-infinite-teal" />}
        borderColorClass="border-infinite-teal"
        badgeColorClass={getSourceColor('class')}
        features={featuresBySource.class}
        badgeLabel={(feature) => (
          <>
            {character.class?.name} {feature.level && `${feature.level}`}
          </>
        )}
        showUsage
      />

      {/* Background Features */}
      <FeatureCategoryCard
        title="Background Features"
        icon={<BookOpen className="w-5 h-5 text-infinite-purple" />}
        borderColorClass="border-infinite-purple"
        badgeColorClass={getSourceColor('background')}
        features={featuresBySource.background}
        badgeLabel={() => character.background?.name}
      />

      {/* Feats */}
      <FeatureCategoryCard
        title="Feats"
        icon={<Zap className="w-5 h-5 text-orange-600" />}
        borderColorClass="border-orange-500"
        badgeColorClass={getSourceColor('feat')}
        features={featuresBySource.feat}
        badgeLabel={() => 'Feat'}
      />

      {/* Proficiencies */}
      <FeaturesProficienciesCard />
    </div>
  );
};

export default FeaturesTab;
