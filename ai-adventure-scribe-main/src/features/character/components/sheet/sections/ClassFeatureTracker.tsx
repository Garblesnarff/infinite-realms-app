import React from 'react';

import type { Character } from '@/types/character';

import logger from '@/lib/logger';
import { restApi } from '@/services/rest-api';
import { getClassFeatures, getCharacterResources } from '@/utils/classFeatures';
import { processLongRest, processShortRest } from '@/utils/restMechanics';

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
      const processed =
        restType === 'short'
          ? processShortRest(character, 0).character
          : processLongRest(character).character;
      onUpdate({
        ...processed,
        hitPoints: processed.hitPoints
          ? {
              ...processed.hitPoints,
              current:
                restType === 'long'
                  ? processed.hitPoints.maximum
                  : Math.min(
                      processed.hitPoints.maximum,
                      processed.hitPoints.current + result.hpRestored,
                    ),
            }
          : processed.hitPoints,
      });
      logger.info(`Completed ${restType} rest`, result);
    } catch (error) {
      logger.error(`Failed to complete ${restType} rest`, error);
    }
  };

  // Handle using a resource
  const handleUseResource = (resourceName: string) => {
    // In a real implementation, this would update the character's resources
    logger.info(`Using resource: ${resourceName}`);

    // This would be implemented with actual resource usage logic
    // For example:
    // const updatedResources = { ...character.resources };
    // updatedResources[resourceName].current -= 1;
    // onUpdate({ ...character, resources: updatedResources });
  };

  // If no class features or resources, don't render anything
  if (classFeatures.length === 0 && !characterResources) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Class Features with Usage Tracking */}
      <FeatureSection
        character={character}
        classFeatures={classFeatures}
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
