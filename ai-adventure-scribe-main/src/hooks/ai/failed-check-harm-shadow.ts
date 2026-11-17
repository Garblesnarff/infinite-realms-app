import type { PersistedRollOutcome } from '@/types/session-state';

import logger from '@/lib/logger';
import { AIService, type ChatMessage } from '@/services/ai-service';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

/** #610: a failed non-combat check narrates injury and the engine applied no damage. Shadow only. */
export const FAILED_CHECK_HARM_SHADOW_REASON = 'failed_check_harm_without_engine_damage';

/**
 * Injury words a failed non-combat check narration uses (#610, Hark N3-030 / P1016-006). Each
 * carries a name; the shadow logs and reports names only, never the matched text.
 */
const FAILED_CHECK_INJURY_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'rope_burn', re: /\brope\s+burns?\b|\bburns?\s+(?:across|on)\s+your\b/gi },
  { name: 'dragged', re: /\bdragged\b/gi },
  { name: 'singed_blister', re: /\bsinged\b|\bblister(?:s|ed|ing)?\b/gi },
  { name: 'bleeding', re: /\bbleed(?:s|ing)?\b|\bblood\b/gi },
  { name: 'bruised', re: /\bbruis(?:e|es|ed|ing)\b/gi },
  { name: 'wounded_injured', re: /\b(?:wounded|injur(?:ed|y))\b/gi },
  { name: 'hit_hard_surface', re: /\bhit\s+the\s+(?:hard|cold|stone|ground|rock|floor)\b/gi },
  { name: 'buckled_knees', re: /\bbuckl(?:e|es|ed|ing)\s+(?:your\s+)?knees\b/gi },
];

/** The clause around a match, bounded by punctuation. The hero must be in it (#610 FIX). */
function clauseAround(source: string, index: number, matched: string): string {
  const before = source.slice(0, index);
  const start = Math.max(
    before.lastIndexOf(','),
    before.lastIndexOf(';'),
    before.lastIndexOf(':'),
    before.lastIndexOf('.'),
    before.lastIndexOf('!'),
    before.lastIndexOf('?'),
  );
  const rest = source.slice(index + matched.length);
  const stop = /[,;:.!?]/.exec(rest);
  return source.slice(start + 1, stop ? index + matched.length + stop.index : source.length);
}

/**
 * The names of the injury patterns that match the hero in a reply (#610): the match must sit in a
 * clause with a second-person subject, and must not be negated in its sentence. Empty when clean.
 * Returns names only; the caller logs and reports these.
 */
export function failedCheckHarmShadowPatterns(text: string | null | undefined): string[] {
  const source = text ?? '';
  const names = new Set<string>();
  for (const { name, re } of FAILED_CHECK_INJURY_PATTERNS) {
    for (const match of source.matchAll(re)) {
      const index = match.index ?? 0;
      const matched = match[0];
      if (!/\b(?:you|your|yourself)\b/i.test(clauseAround(source, index, matched))) continue;
      const sentenceStart = Math.max(
        source.lastIndexOf('.', index - 1),
        source.lastIndexOf('!', index - 1),
        source.lastIndexOf('?', index - 1),
      );
      const before = source.slice(sentenceStart + 1, index);
      if (/\b(?:no|not|never|nothing|without|nor)\b|n['’]t\b/i.test(before)) continue;
      names.add(name);
    }
  }
  return [...names];
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
  const patterns = failedCheckHarmShadowPatterns(params.narration.text);
  if (!patterns.length) return;
  logger.warn('DM_NARRATION_SHADOW', {
    reason: FAILED_CHECK_HARM_SHADOW_REASON,
    sessionId: params.sessionId,
    requestId: AIService.lastRequestId(),
    branch: 'narrative',
    patterns,
  });
  reportNarrationShadowHit('failed_check_harm_without_engine', params.sessionId, patterns);
}
