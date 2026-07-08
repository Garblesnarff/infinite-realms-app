import React from 'react';

import type { Character } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import logger from '@/lib/logger';
import { updateCharacterClassFeatures } from '@/services/class-features-api';
import { applyRestResultToCharacter, restApi } from '@/services/rest-api';
import { getClassFeatures, getCharacterResources } from '@/utils/classFeatures';

import { FeatureSection } from './class-feature-tracker/FeatureSection';
import { ResourceSection } from './class-feature-tracker/ResourceSection';
import { RestActionButtons } from './class-feature-tracker/RestActionButtons';

interface ClassFeatureTrackerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * ClassFeatureTracker component displays and manages character class feature usage
 * including resources like spell slots, ki points, rages, etc.
 */
const ClassFeatureTracker: React.FC<ClassFeatureTrackerProps> = ({ character, onUpdate }) => {
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
      onUpdate(applyRestResultToCharacter(character, result));
      logger.info(`Completed ${restType} rest`, result);
    } catch (error) {
      logger.error(`Failed to complete ${restType} rest`, error);
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

    onUpdate(updatedCharacter);
    try {
      await updateCharacterClassFeatures(character.id, classFeaturesState);
      logger.info(`Used class feature: ${feature.name}`, featureState);
    } catch (error) {
      onUpdate(character);
      logger.error(`Failed to use class feature: ${feature.name}`, error);
    }
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
