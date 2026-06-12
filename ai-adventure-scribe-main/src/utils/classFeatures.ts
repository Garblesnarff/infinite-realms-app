/**
 * Class Features Definitions and Utilities
 *
 * Defines all D&D 5e class features and their combat effects
 */

import {
  getRageDamageBonus,
  getBardicInspirationDie,
  canUseSneakAttack,
  getSneakAttackDice,
  getDivineSmiteDamage,
  getMartialArtsDie,
  calculateUnarmoredDefenseAC,
  hasUnarmoredDefense,
  activateRage,
  deactivateRage,
} from './classMechanics';

import type { ClassFeature, CharacterResources } from '@/types/combat';

import {
  CLASS_FEATURES_MAP,
  getInitialCharacterResources,
} from '@/utils/character/class-definitions';

// Re-export mechanics for backward compatibility
export {
  getRageDamageBonus,
  getBardicInspirationDie,
  canUseSneakAttack,
  getSneakAttackDice,
  getDivineSmiteDamage,
  getMartialArtsDie,
  calculateUnarmoredDefenseAC,
  hasUnarmoredDefense,
  activateRage,
  deactivateRage,
};

/**
 * Get class features for a given class and level
 */
export function getClassFeatures(className: string, level: number): ClassFeature[] {
  return CLASS_FEATURES_MAP[className.toLowerCase()]?.(level) || [];
}

/**
 * Initialize character resources based on class and level
 */
export function getCharacterResources(className: string, level: number): CharacterResources {
  return getInitialCharacterResources(className, level);
}

/**
 * Check if a class feature can be used
 */
export function canUseClassFeature(feature: ClassFeature, resources: CharacterResources): boolean {
  if (feature.type === 'passive') return true;
  if (!feature.maxUses) return true;

  // Check specific resource requirements
  switch (feature.name) {
    case 'ki':
      return (resources.kiPoints?.current || 0) > (feature.resourceCost || 1);
    default:
      return (feature.currentUses || 0) > 0;
  }
}

/**
 * Use a class feature (decrement uses or resources)
 */
export function useClassFeature(
  feature: ClassFeature,
  resources: CharacterResources,
): { feature: ClassFeature; resources: CharacterResources } {
  const updatedFeature = { ...feature };
  const updatedResources = { ...resources };

  // Handle resource costs (Ki, Sorcery Points, etc.)
  if (feature.resourceCost) {
    switch (feature.name) {
      case 'ki':
        if (updatedResources.kiPoints) {
          updatedResources.kiPoints = {
            ...updatedResources.kiPoints,
            current: Math.max(0, updatedResources.kiPoints.current - feature.resourceCost),
          };
        }
        break;
    }
  } else if (feature.currentUses !== undefined && feature.currentUses > 0) {
    // Handle uses per rest features
    updatedFeature.currentUses = feature.currentUses - 1;
  }

  return { feature: updatedFeature, resources: updatedResources };
}

/**
 * Restore class feature uses on rest
 */
export function restoreClassFeatures(
  features: ClassFeature[],
  resources: CharacterResources,
  restType: 'short' | 'long',
): { features: ClassFeature[]; resources: CharacterResources } {
  const updatedFeatures = features.map((feature) => {
    if (
      feature.usesPerRest === restType ||
      (restType === 'long' && feature.usesPerRest === 'short')
    ) {
      return {
        ...feature,
        currentUses: feature.maxUses || 0,
      };
    }
    return feature;
  });

  const updatedResources = { ...resources };

  // Restore resources
  if (restType === 'short' || restType === 'long') {
    Object.keys(updatedResources).forEach((key) => {
      const resource = updatedResources[key as keyof CharacterResources] as
        | { max: number; current: number }
        | undefined;
      if (resource && typeof resource === 'object' && 'max' in resource && 'current' in resource) {
        resource.current = resource.max;
      }
    });
  }

  return { features: updatedFeatures, resources: updatedResources };
}
