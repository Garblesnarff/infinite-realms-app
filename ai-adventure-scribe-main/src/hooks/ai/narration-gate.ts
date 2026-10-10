import type { EngineOutcome } from '@/hooks/ai/silent-player-turn';
import type { PlayerInputOrigin } from '@/services/combat/combat-action-origin';

import { contradictsEngineOutcome, fabricatedOutcomeClaims } from '@/hooks/ai/silent-player-turn';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';

/**
 * The one check every DM reply passes when the turn produced no engine event (#2373).
 *
 * #2349 told the DM that a free-text non-action had no mechanical effect, and logged when the
 * reply narrated one anyway. Run M9, round 3: the player typed "I try to talk it down", the engine
 * printed nothing, and the DM wrote "you narrowly avoid a strike from the entity, though a glancing
 * blow still leaves you feeling rattled and wounded" while HP stayed 4/7. An instruction the model
 * follows most of the time is not a rule, so this rejects the reply, asks once more with the
 * violation named, and on a repeat says nothing happened instead of shipping the claim.
 *
 * Both branches call it: the in-combat silent turn (`combat-resolution-step.ts`, after its
 * resolution-only narration) and the out-of-combat narrative turn (`use-ai-response.ts`, on the
 * first-pass reply). What differs is only how a reply is regenerated.
 */

/** Said in place of a narration that claimed harm twice. States the outcome, not the attempt. */
export const NEUTRAL_NO_EFFECT_LINE =
  '*(Nothing comes of that — the moment passes without effect.)*';

export const NARRATION_REJECTED_REASON = 'harm_claim_without_engine_event';

/** #266: the reply contradicted the engine's authoritative verdict for the turn. */
export const NARRATION_OUTCOME_REJECTED_REASON = 'outcome_contradicts_engine';

/** What the DM is told about the reply it just wrote. */
export function narrationViolationNote(claims: string[]): string {
  return (
    'Your previous reply for this turn was rejected. The engine resolved nothing for it: no roll, ' +
    `no attack, no damage, no condition. It claimed ${claims.map((claim) => `"${claim}"`).join(', ')}. ` +
    'Nothing hit, wounded, damaged or afflicted the player, and no creature attacked. Write the ' +
    'reply again without any strike, hit, blow, damage, wound, HP change, condition or creature ' +
    'attack. Do not mention this correction.'
  );
}

/** What the DM is told when its reply contradicted the engine's verdict (#266). */
export function engineOutcomeViolationNote(outcome: EngineOutcome, claims: string[]): string {
  return (
    'Your previous reply for this turn was rejected. The engine already resolved the roll: it ' +
    `${outcome.success ? 'SUCCEEDED' : 'FAILED'}. It claimed ${claims.map((claim) => `"${claim}"`).join(', ')}, ` +
    'which contradicts the engine result. Narrate the turn following the engine result — ' +
    (outcome.success
      ? 'the attempt came off; do not describe it failing, missing, or falling short.'
      : 'the attempt failed; do not describe it succeeding.') +
    ' Do not mention this correction.'
  );
}

interface GatedNarration {
  text?: string | null;
  narrationSegments?: unknown;
  options?: unknown;
  handout_actions?: unknown;
  map_actions?: unknown;
  scene_spec?: unknown;
  heldSideEffects?: () => Promise<void>;
}

/**
 * Runs the memory, world-update and voice work `AIService.chatWithDM` parked for this reply
 * (`holdSideEffects`). A no-op for a reply that parked nothing, and once-only for one that did.
 */
export function releaseHeldSideEffects(reply: GatedNarration | null | undefined): void {
  void reply?.heldSideEffects?.();
}

export type NarrationGateOutcome = 'clean' | 'regenerated' | 'replaced';

export interface NarrationGateParams<T extends GatedNarration> {
  /** The DM reply for a turn with no engine event. */
  narration: T;
  sessionId?: string;
  branch: 'combat' | 'narrative';
  /** Outside combat the player's own spell or blow may be narrated; see `fabricatedOutcomeClaims`. */
  playerMayHaveActed?: boolean;
  encounterId?: string;
  /**
   * #266: the engine's authoritative verdict for the turn (a roll it decided). When present the
   * harm check is skipped — the engine did resolve something, so harm claims may be legitimate —
   * and the reply must not contradict the verdict instead.
   */
  engineOutcome?: EngineOutcome | null;
  /** Asks the DM again with the violation named; resolves the new reply. */
  regenerate: (violation: string) => Promise<T>;
}

export async function enforceNarrationGate<T extends GatedNarration>(
  params: NarrationGateParams<T>,
): Promise<{ narration: T; outcome: NarrationGateOutcome }> {
  const { narration, sessionId, branch, playerMayHaveActed, encounterId, regenerate, engineOutcome } =
    params;
  const options = { playerMayHaveActed };
  const logRejection = (attempt: 1 | 2, claims: string[], reason: string): void =>
    logger.warn('DM_NARRATION_REJECTED', {
      reason,
      sessionId,
      requestId: AIService.lastRequestId(),
      branch,
      attempt,
      claims,
      ...(encounterId ? { encounterId } : {}),
    });

  // #266: with an engine verdict the check is contradiction, not fabrication — a hit deals
  // damage legitimately, so the harm patterns must not run here.
  const contradictions = engineOutcome ? contradictsEngineOutcome(narration.text, engineOutcome) : [];
  const claims = engineOutcome ? [] : fabricatedOutcomeClaims(narration.text, options);
  const violations = engineOutcome ? contradictions : claims;
  const reason = engineOutcome ? NARRATION_OUTCOME_REJECTED_REASON : NARRATION_REJECTED_REASON;
  const violationNote = engineOutcome
    ? engineOutcomeViolationNote(engineOutcome, contradictions)
    : narrationViolationNote(claims);
  if (!violations.length) {
    releaseHeldSideEffects(narration);
    return { narration, outcome: 'clean' };
  }
  logRejection(1, violations, reason);

  try {
    const retry = await regenerate(violationNote);
    const repeated = engineOutcome
      ? contradictsEngineOutcome(retry.text, engineOutcome)
      : fabricatedOutcomeClaims(retry.text, options);
    if (!repeated.length) {
      releaseHeldSideEffects(retry);
      return { narration: retry, outcome: 'regenerated' };
    }
    logRejection(2, repeated, reason);
  } catch {
    logRejection(2, violations, 'regeneration_failed');
  }
  // Neither reply is kept: nothing they parked runs, and nothing they carried survives.
  return {
    narration: {
      ...narration,
      text: NEUTRAL_NO_EFFECT_LINE,
      narrationSegments: undefined,
      options: undefined,
      handout_actions: [],
      map_actions: [],
      scene_spec: null,
      heldSideEffects: undefined,
    },
    outcome: 'replaced',
  };
}

export interface NarrativeTurn {
  isInCombat: boolean;
  isDiceRollMessage: boolean;
  /** `null` when no player message started the turn (the opening scene, a resumed turn). */
  playerInputOrigin: PlayerInputOrigin | null;
  result: {
    text?: string;
    roll_requests?: unknown[];
    combat_actions?: unknown[];
    combatants?: unknown[];
    combat_transition?: string;
    combat_entry_pending?: unknown;
    combat_entry?: unknown;
  };
}

/**
 * A turn outside combat that the engine has nothing to resolve: a player message, no dice result,
 * no roll request, no combat declaration or entry. The DM's prose is the only account of it.
 * Each clause is a turn where the engine does have something to say, or where nobody spoke.
 */
export function narrativeTurnHasNoEngineEvent({
  isInCombat,
  isDiceRollMessage,
  playerInputOrigin,
  result,
}: NarrativeTurn): boolean {
  return (
    !isInCombat &&
    !isDiceRollMessage &&
    playerInputOrigin !== null &&
    !result.combat_actions?.length &&
    !result.combatants?.length &&
    !result.roll_requests?.length &&
    (!result.combat_transition || result.combat_transition === 'none') &&
    !result.combat_entry_pending &&
    !result.combat_entry &&
    !/```ROLL_REQUESTS_V1/.test(result.text ?? '')
  );
}
