import type { EngineResultCard } from '@/services/combat/engine-result-card';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

export interface LethalActResponse {
  success: boolean;
  natural: number;
  modifier: number;
  total: number;
  dc: number;
  damage: number;
  vitalState: string;
  currentHitPoints: number;
  maxHitPoints: number;
  engineCard: EngineResultCard;
}

export async function submitConfirmedLethalAct(
  sessionId: string,
  text: string,
): Promise<LethalActResponse> {
  const response = await fetchWithAuth(`/v1/sessions/${encodeURIComponent(sessionId)}/lethal-act`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Lethal act failed with status ${response.status}`);
  }
  return (await response.json()) as LethalActResponse;
}
