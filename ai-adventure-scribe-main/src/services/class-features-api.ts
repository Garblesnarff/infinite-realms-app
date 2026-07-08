import type { Character } from '@/types/character';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export async function updateCharacterClassFeatures(
  characterId: string,
  classFeatures: Character['classFeatures'],
): Promise<void> {
  const token = window.localStorage.getItem('workos_access_token');
  const response = await fetch(`${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ class_features: classFeatures }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Class feature update failed with status ${response.status}`);
  }
}
