import type { PersistedRollOutcome } from '@/types/session-state';

import logger from '@/lib/logger';
import { AIService, type ChatMessage } from '@/services/ai-service';

/** #610: a failed non-combat check narrates injury and the engine applied no damage. Shadow only. */
export const FAILED_CHECK_HARM_SHADOW_REASON = 'failed_check_harm_without_engine_damage';

/** Injury words a failed non-combat check narration uses (#610, Hark N3-030 / P1016-006). */
const FAILED_CHECK_INJURY_PATTERNS: RegExp[] = [
  /\brope\s+burns?\b|\bburns?\s+(?:across|on)\s+your\b/gi,
  /\bdragged\b/gi,
  /\bsinged\b|\bblister(?:s|ed|ing)?\b/gi,
  /\bbleed(?:s|ing)?\b|\bblood\b/gi,
  /\bbruis(?:e|es|ed|ing)\b/gi,
  /\b(?:wounded|injur(?:ed|y))\b/gi,
  /\bhit\s+the\s+(?:hard|cold|stone|ground|rock|floor)\b/gi,
  /\bbuckl(?:e|es|ed|ing)\s+(?:your\s+)?knees\b/gi,
];

/** Injury phrases in a reply, not negated within their sentence (#610). Empty when clean. */
export function failedCheckHarmShadowClaims(text: string | null | undefined): string[] {
  const source = text ?? '';
  const phrases = new Set<string>();
  for (const pattern of FAILED_CHECK_INJURY_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const sentenceStart = Math.max(
        source.lastIndexOf('.', index - 1),
        source.lastIndexOf('!', index - 1),
        source.lastIndexOf('?', index - 1),
      );
      const before = source.slice(sentenceStart + 1, index);
      if (/\b(?:no|not|never|nothing|without|nor)\b|n['’]t\b/i.test(before)) continue;
      phrases.add(match[0].trim().toLowerCase().slice(0, 80));
    }
  }
  return [...phrases].slice(0, 5);
}

export interface FailedCheckHarmShadowParams {
  narration: { text?: string | null };
  sessionId: string;
  /** Combat resolves damage through the engine, so a failed attack's harm is not shadowed. */
  inCombat: boolean;
  /** The reply's `damage` field; a non-null object means the engine applied story damage. */
  declaredDamage?: unknown;
  conversationHistory: ChatMessage[];
  getOutcome: (sessionId: string) => Promise<PersistedRollOutcome | null>;
  isStale: (outcome: PersistedRollOutcome, history: ChatMessage[]) => boolean;
}

/**
 * #610 shadow: logs `DM_NARRATION_SHADOW` when a failed non-combat check's reply claims injury
 * and no engine damage was applied. It changes no reply. Enforcement waits for the count.
 * Fails open: a lookup error logs nothing and lets the turn through.
 */
export async function shadowFailedCheckHarm(params: FailedCheckHarmShadowParams): Promise<void> {
  const outcome = await params.getOutcome(params.sessionId).catch(() => null);
  if (!outcome || outcome.success || params.inCombat) return;
  if (params.isStale(outcome, params.conversationHistory)) return;
  const damage = params.declaredDamage;
  if (damage !== null && damage !== undefined && typeof damage === 'object') return;
  const claims = failedCheckHarmShadowClaims(params.narration.text);
  if (!claims.length) return;
  logger.warn('DM_NARRATION_SHADOW', {
    reason: FAILED_CHECK_HARM_SHADOW_REASON,
    sessionId: params.sessionId,
    requestId: AIService.lastRequestId(),
    branch: 'narrative',
    claims,
  });
}
