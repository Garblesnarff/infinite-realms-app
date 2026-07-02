/**
 * Per-session localStorage helpers for capping and de-duplicating
 * DM scene image auto-generation, split out of useImageGeneration.ts.
 */

const capKey = (sessionId: string) => `dm-img-cap:${sessionId}`;
const trigKey = (sessionId: string, messageId: string) => `dm-img-trig:${sessionId}:${messageId}`;

export function getImageGenerationCap(sessionId?: string): number {
  return sessionId ? Number.parseInt(localStorage.getItem(capKey(sessionId)) || '0') : 0;
}

export function incrementImageGenerationCap(sessionId?: string): void {
  if (!sessionId) return;
  const next = getImageGenerationCap(sessionId) + 1;
  localStorage.setItem(capKey(sessionId), String(next));
}

export function hasImageGenerationTriggered(sessionId?: string, messageId?: string): boolean {
  return !!sessionId && !!messageId
    ? localStorage.getItem(trigKey(sessionId, messageId)) === '1'
    : false;
}

export function markImageGenerationTriggered(sessionId?: string, messageId?: string): void {
  if (!sessionId || !messageId) return;
  localStorage.setItem(trigKey(sessionId, messageId), '1');
}
