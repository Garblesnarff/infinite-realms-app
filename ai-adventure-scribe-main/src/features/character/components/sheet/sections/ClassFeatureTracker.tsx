import React from 'react';

import { FeatureSection } from './class-feature-tracker/FeatureSection';
import { refusalToastText } from './class-feature-tracker/refusal-toast-text';
import { ResourceSection } from './class-feature-tracker/ResourceSection';
import { SheetRestControls } from './class-feature-tracker/SheetRestControls';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { getClassFeatures, getCharacterResources } from '@/utils/classFeatures';

interface ClassFeatureTrackerProps {
  character: Character;
  onUpdate: CharacterSheetUpdateFn;
  /** Reloads the saved character after a server-side feature use (#1576). Makes no write. */
  onServerStateChanged?: () => Promise<void> | void;
}

/**
 * ClassFeatureTracker component displays and manages character class feature usage
 * including resources like spell slots, ki points, rages, etc.
 */
const ClassFeatureTracker: React.FC<ClassFeatureTrackerProps> = ({
  character,
  onUpdate,
  onServerStateChanged,
}) => {
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

  // #712: the Lay on Hands bar reads static level x 5 values. When the
  // server has mirrored the real pool into the sheet JSON (a spend or a
  // rest), show the real pool so the bar and the feature row agree.
  const layOnHandsTracked = trackedClassFeatures.find((feature) => feature.name === 'lay_on_hands');
  const layOnHandsResources =
    characterResources && layOnHandsTracked?.currentUses !== undefined
      ? {
          ...characterResources,
          layOnHands: {
            current: layOnHandsTracked.currentUses,
            max: layOnHandsTracked.maxUses ?? characterResources.layOnHands?.max ?? 0,
          },
        }
      : characterResources;
  const divineSenseTracked = trackedClassFeatures.find(
    (feature) => feature.name === 'divine_sense',
  );
  const displayResources =
    layOnHandsResources &&
    divineSenseTracked?.currentUses !== undefined &&
    divineSenseTracked.maxUses !== undefined
      ? {
          ...layOnHandsResources,
          divineSense: { current: divineSenseTracked.currentUses, max: divineSenseTracked.maxUses },
        }
      : layOnHandsResources;

  // #264: rests go through the shared SheetRestControls (hit-dice prompt on short
  // rest), the same path as the Main tab.

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
      // #1576: the server rolls 1d10 plus the fighter level, heals and spends the use in one
      // transaction. The sheet shows the server's numbers; it neither rolls nor saves the character.
      try {
        const result = await userDataApi.secondWind(character.id);
        toast({
          title: 'Feature used',
          description: `second wind: ${result.usesRemaining} / ${feature.maxUses}. Healed ${result.healed} HP (now ${result.newHp} of ${result.maxHp}).`,
        });
        // The sheet reloads the server's saved state (HP and the use) without a save of its own.
        await onServerStateChanged?.();
      } catch (error) {
        logger.error('Second Wind failed', error);
        toast({
          title: 'Second Wind',
          description: refusalToastText(error),
          variant: 'destructive',
        });
      }
      return;
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
      {displayResources && (
        <ResourceSection
          characterResources={displayResources}
          hitDice={character.hitDice}
          characterId={character.id}
        />
      )}

      {/* Rest Actions */}
      <SheetRestControls character={character} onUpdate={onUpdate} />
    </div>
  );
};

export default ClassFeatureTracker;
