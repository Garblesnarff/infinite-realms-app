import type { Character } from '@/types/character';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

/** Library row joined onto a granted feature (`class_features_library`). */
export interface CharacterFeatureRow {
  id: string;
  characterId: string;
  featureId: string;
  usesRemaining: number | null;
  isActive: boolean;
  acquiredAtLevel: number;
  createdAt: string;
  feature?: {
    id: string;
    className: string;
    subclassName: string | null;
    featureName: string;
    levelAcquired: number;
    description: string;
    mechanicalEffects: string | null;
    usageType: string | null;
    usesPerRest: string | null;
    usesCount: number | null;
    createdAt: string;
  };
}

/** Response of `GET /v1/class-features/characters/:id/features`. */
export interface CharacterClassFeaturesResponse {
  features: CharacterFeatureRow[];
  usesRemaining: Record<string, number>;
}

export async function getCharacterClassFeatures(
  characterId: string,
): Promise<CharacterClassFeaturesResponse> {
  const response = await fetchWithAuth(
    `/v1/class-features/characters/${encodeURIComponent(characterId)}/features`,
    { retryBudgetMs: 0 },
  );

  if (!response.ok) {
    throw new Error(`Class features request failed with status ${response.status}`);
  }

  return (await response.json()) as CharacterClassFeaturesResponse;
}

/**
 * The chosen subclass row (`GET .../subclass/:className`). 404 is "no row",
 * not a failure. One attempt: this read must not hold the sheet behind retries.
 */
export async function getCharacterSubclass(
  characterId: string,
  className: string,
): Promise<string | null> {
  const response = await fetchWithAuth(
    `/v1/class-features/characters/${encodeURIComponent(characterId)}/subclass/${encodeURIComponent(className)}`,
    { retryBudgetMs: 0 },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Subclass request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { subclass?: { subclassName?: unknown } };
  const name = body.subclass?.subclassName;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

export async function updateCharacterClassFeatures(
  characterId: string,
  classFeatures: Character['classFeatures'],
): Promise<void> {
  const response = await fetchWithAuth(`/v1/characters/${encodeURIComponent(characterId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ class_features: classFeatures }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Class feature update failed with status ${response.status}`);
  }
}
