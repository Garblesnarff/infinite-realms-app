import { Star, Users, Zap, BookOpen } from 'lucide-react';
import React from 'react';

import { FeatureCategoryCard } from './FeatureCategoryCard';
import { FeaturesProficienciesCard } from './FeaturesProficienciesCard';
import ClassFeatureTracker from '../sections/ClassFeatureTracker';
import FightingStylesDisplay from '../sections/FightingStylesDisplay';

import type { Character } from '@/types/character';

interface FeaturesTabProps {
  character: Character;
  onUpdate: () => void;
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
  // Example features (would be calculated based on character's race, class, level, etc.)
  const features: Feature[] = [
    // Racial Features
    {
      name: 'Darkvision',
      source: 'race',
      description:
        'You can see in dim light within 60 feet of you as if it were bright light, and in darkness as if it were dim light.',
    },
    {
      name: 'Fey Ancestry',
      source: 'race',
      description:
        'You have advantage on saving throws against being charmed, and magic cannot put you to sleep.',
    },
    // Class Features
    {
      name: 'Fighting Style: Defense',
      source: 'class',
      level: 1,
      description: 'While you are wearing armor, you gain a +1 bonus to AC.',
    },
    {
      name: 'Second Wind',
      source: 'class',
      level: 1,
      description:
        'You can use a bonus action to regain hit points equal to 1d10 + your fighter level.',
      uses: { total: 1, used: 0, recharge: 'short' },
    },
    {
      name: 'Action Surge',
      source: 'class',
      level: 2,
      description: 'You can take one additional action on your turn.',
      uses: { total: 1, used: 1, recharge: 'short' },
    },
    {
      name: 'Martial Archetype: Champion',
      source: 'class',
      level: 3,
      description: 'Your weapon attacks score a critical hit on a roll of 19 or 20.',
    },
    // Background Features
    {
      name: 'Guild Membership',
      source: 'background',
      description:
        'As an established member of a guild, you can rely on certain benefits that membership provides.',
    },
  ];

  const _getFeatureIcon = (source: string) => {
    switch (source) {
      case 'race':
        return <Users className="w-4 h-4 text-green-600" />;
      case 'class':
        return <Star className="w-4 h-4 text-blue-600" />;
      case 'background':
        return <BookOpen className="w-4 h-4 text-purple-600" />;
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
        return 'bg-white/10 text-muted-foreground border border-white/10';
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
        icon={<Users className="w-5 h-5 text-green-600" />}
        borderColorClass="border-green-500"
        badgeColorClass={getSourceColor('race')}
        features={featuresBySource.race}
        badgeLabel={() => character.race?.name}
      />

      {/* Class Features */}
      <FeatureCategoryCard
        title="Class Features"
        icon={<Star className="w-5 h-5 text-blue-600" />}
        borderColorClass="border-blue-500"
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
        icon={<BookOpen className="w-5 h-5 text-purple-600" />}
        borderColorClass="border-purple-500"
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
