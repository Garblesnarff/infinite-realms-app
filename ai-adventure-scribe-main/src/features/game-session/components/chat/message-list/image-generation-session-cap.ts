/**
 * Per-session localStorage helpers for capping and de-duplicating
 * DM scene image auto-generation, split out of useImageGeneration.ts.
 */

import { parseBoundedInteger } from '@/utils/bounded-integer';

export const MAX_IMAGE_GENERATIONS_PER_SESSION = 100;

const capKey = (sessionId: string): string => `dm-img-cap:${sessionId}`;
const trigKey = (sessionId: string, messageId: string): string =>
  `dm-img-trig:${sessionId}:${messageId}`;

export function getImageGenerationCap(sessionId?: string): number {
  if (!sessionId) return 0;

  const storedCap = localStorage.getItem(capKey(sessionId));
  if (storedCap === null) return 0;

  return parseBoundedInteger(storedCap, {
    fallback: MAX_IMAGE_GENERATIONS_PER_SESSION,
    min: 0,
    max: MAX_IMAGE_GENERATIONS_PER_SESSION,
    outOfRange: 'fallback',
  });
}

export function incrementImageGenerationCap(sessionId?: string): void {
  if (!sessionId) return;
  const next = Math.min(getImageGenerationCap(sessionId) + 1, MAX_IMAGE_GENERATIONS_PER_SESSION);
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
