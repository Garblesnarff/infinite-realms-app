const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export interface RestApiResult {
  characterId: string;
  restType: 'short' | 'long';
  hpRestored: number;
  hitDiceSpent?: number;
  hitDiceRestored?: number;
}

async function requestRest(
  characterId: string,
  restType: 'short' | 'long',
  hitDiceToSpend: number = 0,
): Promise<RestApiResult> {
  const token = window.localStorage.getItem('workos_access_token');
  const response = await fetch(
    `${API_BASE_URL}/v1/rest/characters/${encodeURIComponent(characterId)}/${restType}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(restType === 'short' ? { hitDiceToSpend } : {}),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Rest failed with status ${response.status}`);
  }
  return response.json() as Promise<RestApiResult>;
}

export const restApi = {
  shortRest: (characterId: string, hitDiceToSpend: number = 0) =>
    requestRest(characterId, 'short', hitDiceToSpend),
  longRest: (characterId: string) => requestRest(characterId, 'long'),
  attuneItem: async (characterId: string, itemId: string): Promise<void> => {
    const token = window.localStorage.getItem('workos_access_token');
    const response = await fetch(
      `${API_BASE_URL}/v1/characters/${encodeURIComponent(characterId)}/attune/${encodeURIComponent(itemId)}`,
      {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || `Attunement failed with status ${response.status}`);
    }
  },
};
