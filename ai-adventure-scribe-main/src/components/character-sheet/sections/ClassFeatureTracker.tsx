import React from 'react';

import type { Character } from '@/types/character';

import logger from '@/lib/logger';
import { getClassFeatures, getCharacterResources } from '@/utils/classFeatures';

// Duplicated component uses components from the features directory
import { FeatureSection } from '@/features/character/components/sheet/sections/class-feature-tracker/FeatureSection';
import { ResourceSection } from '@/features/character/components/sheet/sections/class-feature-tracker/ResourceSection';
import { RestActionButtons } from '@/features/character/components/sheet/sections/class-feature-tracker/RestActionButtons';

interface ClassFeatureTrackerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * ClassFeatureTracker component displays and manages character class feature usage
 * including resources like spell slots, ki points, rages, etc.
 */
const ClassFeatureTracker: React.FC<ClassFeatureTrackerProps> = ({ character, onUpdate: _onUpdate }) => {
  // Get class features for the character
  const classFeatures = character.class
    ? getClassFeatures(character.class.name, character.level || 1)
    : [];

  // Get character resources
  const characterResources = character.class
    ? getCharacterResources(character.class.name, character.level || 1)
    : null;

  // Handle resource restoration (short rest or long rest)
  const handleRest = (restType: 'short' | 'long') => {
    if (!characterResources) return;

    // In a real implementation, this would update the character's resources
    // For now, we'll just show a message
    logger.info(`Restoring ${restType} rest resources`);

    // This would be implemented with actual resource restoration logic
    // For example:
    // const updatedResources = restoreClassFeatures(classFeatures, characterResources, restType);
    // onUpdate({ ...character, resources: updatedResources });
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
