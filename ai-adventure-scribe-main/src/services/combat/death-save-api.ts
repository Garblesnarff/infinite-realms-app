import type { EngineResultCard } from '@/services/combat/engine-result-card';

import { fetchWithAuth } from '@/infrastructure/api/rest-client';

export interface DeathSaveResponse {
  roll: number;
  successes: number;
  failures: number;
  vitalState: string;
  currentHitPoints: number;
  maxHitPoints: number;
  terminal: boolean;
  hours: number | null;
  engineLines: string[];
  engineCards: EngineResultCard[];
}

export async function submitDeathSave(sessionId: string): Promise<DeathSaveResponse> {
  const response = await fetchWithAuth(`/v1/sessions/${encodeURIComponent(sessionId)}/death-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Death save failed with status ${response.status}`);
  }
  return (await response.json()) as DeathSaveResponse;
}
