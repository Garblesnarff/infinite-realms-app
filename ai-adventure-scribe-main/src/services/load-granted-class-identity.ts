import logger from '@/lib/logger';
import { getCharacterClassFeatures, getCharacterSubclass } from '@/services/class-features-api';

/**
 * Subclass and granted feature names for the sheet (#1019).
 * The character GET does not include `character_subclasses` or
 * `character_features`. These two reads are the ones that do. A failure leaves
 * the fields unset so the rest of the character still loads.
 */

export interface GrantedClassIdentity {
  subclassName?: string;
  grantedFeatureNames?: string[];
}

async function readFeatureNames(
  characterId: string,
): Promise<{ names?: string[]; subclassFromFeature?: string }> {
  try {
    const features = await getCharacterClassFeatures(characterId);
    const names = features.features.flatMap((row) => {
      if (row.isActive === false) return [];
      const name = row.feature?.featureName?.trim();
      return name ? [name] : [];
    });
    const subclassFromFeature = features.features
      .find((row) => row.isActive !== false && row.feature?.subclassName?.trim())
      ?.feature?.subclassName?.trim();
    return { names, ...(subclassFromFeature ? { subclassFromFeature } : {}) };
  } catch (error) {
    logger.warn('[CharacterLoader] Feature rows request failed', { characterId, error });
    return {};
  }
}

async function readSubclassName(
  characterId: string,
  className: string | null | undefined,
): Promise<string | undefined> {
  const trimmed = className?.trim();
  if (!trimmed) return undefined;
  try {
    return (await getCharacterSubclass(characterId, trimmed)) ?? undefined;
  } catch (error) {
    logger.warn('[CharacterLoader] Subclass row request failed', { characterId, error });
    return undefined;
  }
}

export async function loadGrantedClassIdentity(
  characterId: string,
  className: string | null | undefined,
): Promise<GrantedClassIdentity> {
  const [features, subclassName] = await Promise.all([
    readFeatureNames(characterId),
    readSubclassName(characterId, className),
  ]);
  const resolvedSubclass = subclassName ?? features.subclassFromFeature;
  return {
    ...(resolvedSubclass ? { subclassName: resolvedSubclass } : {}),
    ...(features.names ? { grantedFeatureNames: features.names } : {}),
  };
}
