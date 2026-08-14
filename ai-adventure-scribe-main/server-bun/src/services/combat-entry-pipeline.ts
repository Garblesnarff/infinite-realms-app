/**
 * Turn-pipeline integration for the deterministic combat entry gate (#1779 §1–§2).
 *
 * `POST /v1/llm/generate` is the single funnel every DM turn passes through, which makes it the
 * only place where "before the turn's narration returns" is a statement about wall-clock rather
 * than a hope about client ordering. The gate runs here, after contract enforcement (so it
 * judges the accepted dialect, not the raw one) and before the response leaves the server.
 *
 * On entry the returned envelope is REWRITTEN: `combat_transition` becomes `"start"` and
 * `scene_spec` carries the scene that was actually used. That is not cosmetic — the client's
 * post-turn pipeline re-reads authoritative combat state whenever it sees a start transition,
 * so rewriting is what makes the initiative panel appear before the turn's outcome is narrated
 * instead of a turn later. `combat_entry` is added alongside as the explicit, auditable record
 * of what the server decided and why.
 */
import { runCombatEntryGate } from './combat/combat-entry-gate.js';
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
  const { result, userId, combatEntry } = params;
  if (result.error || !combatEntry?.sessionId || !combatEntry.player) return result;

  const envelope = parseEnvelope(result.text);
  if (!envelope) return result;

  // Imported lazily so the decision logic — and its tests — never drag in the database, the
  // tactical generator, or the websocket publisher just to read a DM envelope.
  const deps =
    params.deps ?? (await import('./combat/combat-entry-gate-deps.js')).combatEntryGateDeps;

  const outcome = await runCombatEntryGate(
    {
      sessionId: combatEntry.sessionId,
      userId,
      player: combatEntry.player,
      response: envelope as unknown as CombatEntryResponse,
    },
    deps,
  );
  if (!outcome) return result;

  logger.info({
    msg: 'COMBAT_ENTRY_GATE_ENTERED',
    sessionId: combatEntry.sessionId,
    encounterId: outcome.encounterId,
    trigger: outcome.trigger,
    detail: outcome.detail,
    sceneSpecSynthesized: outcome.sceneSpecSynthesized,
    participants: outcome.participantCount,
  });

  const rewritten = {
    ...envelope,
    combat_transition: 'start',
    scene_spec: outcome.sceneSpec,
    combat_entry: {
      entered: true,
      encounterId: outcome.encounterId,
      trigger: outcome.trigger,
      detail: outcome.detail,
      sceneSpecSynthesized: outcome.sceneSpecSynthesized,
    },
  };
  return { ...result, text: JSON.stringify(rewritten) };
}
