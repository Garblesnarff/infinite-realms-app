import React from 'react';

import { FeatureSection } from './class-feature-tracker/FeatureSection';
import { ResourceSection } from './class-feature-tracker/ResourceSection';
import { RestActionButtons } from './class-feature-tracker/RestActionButtons';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { applyRestResultToCharacter, restApi } from '@/services/rest-api';
import { userDataApi } from '@/services/user-data-api';
import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';
import { getClassFeatures, getCharacterResources } from '@/utils/classFeatures';

interface ClassFeatureTrackerProps {
  character: Character;
  onUpdate: CharacterSheetUpdateFn;
}

/**
 * ClassFeatureTracker component displays and manages character class feature usage
 * including resources like spell slots, ki points, rages, etc.
 */
const ClassFeatureTracker: React.FC<ClassFeatureTrackerProps> = ({ character, onUpdate }) => {
  const { toast } = useToast();
  // Get class features for the character
  const classFeatures = character.class
    ? getClassFeatures(character.class.name, character.level || 1)
    : [];
  const trackedClassFeatures = classFeatures.map((feature) => {
    const tracked =
      character.classFeatures?.[feature.name] ??
      character.classFeatures?.[feature.name.replace(/_/g, '-')] ??
      character.classFeatures?.[feature.name.replace(/_/g, ' ')];
    return tracked && typeof tracked === 'object' ? { ...feature, ...tracked } : feature;
  });

  // Get character resources
  const characterResources = character.class
    ? getCharacterResources(character.class.name, character.level || 1)
    : null;

  // Handle resource restoration (short rest or long rest)
  const handleRest = async (restType: 'short' | 'long') => {
    if (!character.id) return;

    try {
      const result =
        restType === 'short'
          ? await restApi.shortRest(character.id)
          : await restApi.longRest(character.id);
      const saved = await onUpdate(applyRestResultToCharacter(character, result));
      if (!saved) return;
      toast({
        title: restType === 'short' ? 'Short rest complete' : 'Long rest complete',
      });
      logger.info(`Completed ${restType} rest`, result);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to complete ${restType} rest`, error);
      toast({
        title: 'Rest failed',
        description: reason,
        variant: 'destructive',
      });
    }
  };

  // Handle using a resource
  const handleUseResource = async (feature: ClassFeature) => {
    if (!character.id || feature.currentUses === undefined || feature.currentUses <= 0) return;

    const featureState = {
      ...feature,
      currentUses: feature.currentUses - 1,
    };
    const classFeaturesState = {
      ...(character.classFeatures ?? {}),
      [feature.name]: featureState,
    };
    const updatedCharacter = { ...character, classFeatures: classFeaturesState };

    if (feature.name === 'second_wind') {
      const { current, maximum } = getCharacterSheetHitPoints(character);
      if (current !== null && maximum !== null) {
        const roll = Math.floor(Math.random() * 10) + 1;
        const level = character.level ?? 1;
        // Same cap as Apply Healing: current + amount, never above max.
        const nextHp = Math.min(maximum, current + roll + level);
        try {
          await userDataApi.updateCharacterStats(character.id, { current_hit_points: nextHp });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          logger.error('Failed to save Second Wind healing', error);
          toast({
            title: 'Save failed',
            description: reason,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    const saved = await onUpdate(updatedCharacter);
    if (!saved) return;
    toast({
      title: 'Feature used',
      description: `${feature.name.replace(/_/g, ' ')}: ${featureState.currentUses} / ${feature.maxUses}`,
    });
    logger.info(`Used class feature: ${feature.name}`, featureState);
  };

  // If no class features or resources, don't render anything
  if (trackedClassFeatures.length === 0 && !characterResources) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Class Features with Usage Tracking */}
      <FeatureSection
        character={character}
        classFeatures={trackedClassFeatures}
        onUseResource={handleUseResource}
      />

      {/* Character Resources */}
      {characterResources && <ResourceSection characterResources={characterResources} />}

      {/* Rest Actions */}
      <RestActionButtons onRest={handleRest} />
    </div>
  );
};

export default ClassFeatureTracker;
