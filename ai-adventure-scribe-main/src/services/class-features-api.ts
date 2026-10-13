import type { Character } from '@/types/character';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';
import { getAuthHeaders } from '@/services/auth/TokenService';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

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
  );

  if (!response.ok) {
    throw new Error(`Class features request failed with status ${response.status}`);
  }

  return (await response.json()) as CharacterClassFeaturesResponse;
}

export async function updateCharacterClassFeatures(
  characterId: string,
  classFeatures: Character['classFeatures'],
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ class_features: classFeatures }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Class feature update failed with status ${response.status}`);
  }
}
