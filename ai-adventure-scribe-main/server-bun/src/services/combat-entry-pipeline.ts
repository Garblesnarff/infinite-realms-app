/**
 * Turn-pipeline integration for the deterministic combat entry gate (#1779 §1–§2).
 *
 * `POST /v1/llm/generate` is the single funnel every DM turn passes through, which makes it the
 * only place where "before the turn's narration returns" is a statement about wall-clock rather
 * than a hope about client ordering. The gate runs here, after contract enforcement (so it
 * judges the accepted dialect, not the raw one) and before the response leaves the server.
 *
 * On entry the returned envelope receives `combat_entry_pending`, an explicit, auditable handoff
 * containing the server-derived combatants and sanitized scene. It is deliberately not seated
 * here: the player must confirm the entry and may provide their own initiative d20 through the
 * separate `/v1/combat/sessions/:sessionId/enter` endpoint.
 */
import { detectCombatEntry } from './combat/combat-entry-gate.js';
import { sanitizeSceneSpec as defaultSanitizeSceneSpec } from './combat/scene-spec-sanitizer.js';
import { logger } from '../lib/logger.js';

import type {
  CombatEntryGateDeps,
  CombatEntryPlayer,
  CombatEntryResponse,
} from './combat/combat-entry-gate.js';
import type { LLMResponse } from './llm-provider-service.js';

/** What the client must send for the server to be able to seat the player in an encounter. */
export interface CombatEntryContext {
  sessionId: string;
  player: CombatEntryPlayer;
}

const parseEnvelope = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Run the gate for this turn and return the response the client should receive.
 *
 * A turn that does not trigger entry, cannot be parsed, or arrives without a session is
 * returned untouched — the gate is additive and can never withhold narration.
 */
export async function applyCombatEntryGate(params: {
  result: LLMResponse;
  userId: string;
  combatEntry?: CombatEntryContext | null;
  deps?: CombatEntryGateDeps;
}): Promise<LLMResponse> {
  const { result, combatEntry } = params;
  if (result.error || !combatEntry?.sessionId || !combatEntry.player) return result;

  const envelope = parseEnvelope(result.text);
  if (!envelope) return result;

  // Detection is pure. Keep the optional dependency seam for tests that need to assert scene
  // sanitization, but never import or call the database-backed seating dependencies here.
  const pending = detectCombatEntry({
    sessionId: combatEntry.sessionId,
    playerName: combatEntry.player.name,
    response: envelope as unknown as CombatEntryResponse,
    sanitizeSceneSpec: params.deps?.sanitizeSceneSpec ?? defaultSanitizeSceneSpec,
  });
  if (!pending) return result;

  logger.info({
    msg: 'COMBAT_ENTRY_DETECTED_PENDING_PLAYER_ENTRY',
    sessionId: combatEntry.sessionId,
    trigger: pending.trigger,
    detail: pending.detail,
    sceneSpecSynthesized: pending.sceneSpecSynthesized,
    participants: pending.combatants.reduce((total, combatant) => total + combatant.count, 1),
  });

  const rewritten = {
    ...envelope,
    // A pending entry is not a combat transition. This prevents old clients from treating the
    // model's `combat_transition: "start"` as proof that an encounter exists.
    combat_transition: 'none',
    combat_entry_pending: pending,
  };
  return { ...result, text: JSON.stringify(rewritten) };
}
