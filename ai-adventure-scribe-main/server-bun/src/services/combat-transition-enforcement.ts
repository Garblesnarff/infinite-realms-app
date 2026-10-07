import { LLMProviderService, type LLMResponse } from './llm-provider-service.js';
import { logger } from '../lib/logger.js';
import {
  acceptWhateverWasEmitted,
  type AcceptedResponse,
} from '../tactical/accept-attack-dialects.js';
import {
  buildCombatTransitionCorrectivePrompt,
  validateCombatTransitionContract,
} from '../tactical/dispatch.js';
import { claimFirstOffenseHint, encounterKeyFromPrompt } from '../tactical/encounter-hints.js';
import { buildLegacyAttackHintPrompt } from '../tactical/legacy-attack-translation.js';
import {
  buildSpatialCorrectivePrompt,
  validateSpatialCombatContract,
} from '../tactical/spatial-contract.js';
import {
  combatExitsOf,
  describeSceneEndRefusal,
  evaluateSceneEnd,
  findKillClaims,
  partyHasLeftTheFight,
  stripKillSentences,
  type SceneEndParticipant,
} from './combat/combat-end-guard.js';

import type { DMResponse } from './dm/dm-response-schema.js';

const isDmResponseSchema = (schema: unknown): boolean => {
  if (!schema || typeof schema !== 'object') return false;
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  return !!properties?.combat_transition && !!properties?.roll_requests;
};

const combatIsActiveInPrompt = (prompt: string): boolean => {
  const match = /<immutable_game_state>([\s\S]*?)<\/immutable_game_state>/.exec(prompt);
  if (!match) return false;
  try {
    return (JSON.parse(match[1]) as { isInCombat?: unknown }).isInCombat === true;
  } catch {
    return false;
  }
};

const parseDmResponse = (text: string): DMResponse | null => {
  try {
    return JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    ) as DMResponse;
  } catch {
    return null;
  }
};

const combineUsage = (first: LLMResponse, second: LLMResponse): LLMResponse['usage'] => {
  if (!first.usage && !second.usage) return undefined;
  const inputTokens = (first.usage?.inputTokens || 0) + (second.usage?.inputTokens || 0);
  const outputTokens = (first.usage?.outputTokens || 0) + (second.usage?.outputTokens || 0);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
};

/**
 * The client is handed the accepted JSON, not the model's original. Everything downstream —
 * the frontend's `combat_actions` execution, the engine, `<engine_resolved_outcomes>` — reads
 * `result.text`, so an acceptance that is not written back never happened.
 */
const withAcceptance = (response: LLMResponse, accepted: AcceptedResponse): LLMResponse =>
  accepted.rewritten ? { ...response, text: JSON.stringify(accepted.response) } : response;

type ContractBreach = {
  contract: 'combat_transition' | 'spatial' | 'kill_narration';
  correctivePrompt: string;
  detail: Record<string, unknown>;
};

/**
 * The `<turn_order>` block is the prompt's HP-bearing roster (`slug | name | cur/max HP`).
 * It is the only place generation can see hit points, so the kill-language guard judges
 * against it; when the block is absent the guard stays silent and the database choke
 * point in `concludeEncounter` remains authoritative.
 */
function participantsFromPrompt(prompt: string): SceneEndParticipant[] {
  const participants: SceneEndParticipant[] = [];
  const linePattern = /^[→ ]?\s*\d+\.\s+(\S+)\s*\|\s*([^|]+?)\s*\|\s*(\d+)\/(\d+)\s*HP(.*)$/gm;
  for (const match of prompt.matchAll(linePattern)) {
    const currentHp = Number(match[3]);
    // Roles are producer-marked in the block (`role:player` / `role:ally` /
    // `role:hostile`, from engine participant type and authored disposition) so the
    // player off-turn and a standing ally are never mistaken for live hostiles (#2563).
    const tail = match[5] ?? '';
    participants.push({
      id: match[1],
      name: match[2].trim(),
      participantType: tail.includes('role:player') ? 'player' : 'monster',
      disposition: tail.includes('role:ally') ? 'ally' : null,
      isActive: true,
      isCurrentTurn: tail.includes('CURRENT TURN'),
      maxHp: Number(match[4]),
      status: { currentHp, isConscious: currentHp > 0 },
    });
  }
  return participants;
}

/** Kill claims never judge the current-turn actor: "your finishing blow" names the killer, not a corpse. */
const killClaimRoster = (prompt: string): SceneEndParticipant[] =>
  participantsFromPrompt(prompt).filter((participant) => !participant.isCurrentTurn);

/**
 * Live hostiles that forbid a generation-time scene end: roster lines above 0 HP,
 * excluding the current-turn actor, not accounted for by a declared exit.
 *
 * The party-left test (#2580) is taken from the FULL roster, before the current-turn line is
 * filtered out. That filter exists because the creature holding the turn is mid-action and the
 * DM is not deciding about it — but the player's own line is exactly the one filtered, so judging
 * the filtered roster would read "no player in the fight" on every ordinary turn and wave every
 * end through.
 */
function liveHostilesBlockingEnd(response: DMResponse, prompt: string): SceneEndParticipant[] {
  const roster = participantsFromPrompt(prompt);
  if (partyHasLeftTheFight(roster)) return [];
  const decision = evaluateSceneEnd(
    roster.filter((participant) => !participant.isCurrentTurn),
    combatExitsOf(response.combat_exits),
  );
  return decision.allowed ? [] : decision.unaccounted;
}

/**
 * Strip kill sentences from a response that is about to be handed back, whatever
 * contract brought it here (#2524): a fabricated kill must never reach persistence,
 * including on a correction that failed or a retry that breached a different rule.
 */
function stripKillClaimsFromResponse(response: DMResponse, prompt: string): DMResponse {
  const roster = killClaimRoster(prompt);
  // Judged as one narration: `text` and its `narration_segments` are the same prose
  // chunked for voice, so a kill sentence hiding in a segment — or pointed back at
  // from the sentence before it — is judged with its context intact (#2563).
  const claims = findKillClaims(
    [response.text, ...(response.narration_segments ?? []).map((segment) => segment.text)].join(
      ' ',
    ),
    roster,
  );
  if (!claims.length) return response;
  logger.error({
    msg: 'COMBAT_KILL_NARRATION_STRIPPED',
    alert: true,
    claims: claims.map((claim) => claim.participantId),
  });
  const strippedText = stripKillSentences(response.text, claims);
  return {
    ...response,
    text: strippedText || 'The fight is not over.',
    narration_segments: (response.narration_segments ?? []).map((segment) => ({
      ...segment,
      text: stripKillSentences(segment.text, claims),
    })),
    combat_transition: response.combat_transition === 'end' ? 'none' : response.combat_transition,
  };
}

function killBreach(response: DMResponse, prompt: string): ContractBreach | null {
  const participants = killClaimRoster(prompt);
  if (!participants.length) return null;
  const claims = findKillClaims(response.text, participants);
  if (!claims.length) return null;
  const names = [...new Set(claims.map((claim) => claim.participantName))].join(', ');
  return {
    contract: 'kill_narration',
    correctivePrompt:
      `<corrective_instruction>\n` +
      `Narration violation: your text describes ${names} as killed, slain, lifeless or dead, ` +
      `but the engine still counts them alive (hit points above 0). The engine owns death: ` +
      `rewrite without any kill language for them. If a creature fled, surrendered or ` +
      `withdrew, say exactly that and declare it in combat_exits; never narrate it as dead. ` +
      `Return one corrected response now. Do not explain the correction.\n</corrective_instruction>`,
    detail: {
      claims: claims.map((claim) => ({
        participantId: claim.participantId,
        sentence: claim.sentence.slice(0, 120),
      })),
    },
  };
}

/**
 * Both combat contracts are checked against the same response. The transition contract runs
 * first because a response that has not legally entered combat has no board to be coherent with.
 *
 * The old channel contract is gone from this list. Attacks written in `roll_requests` are no
 * longer a breach to argue about — they are translated into `combat_actions` before this runs
 * (see `translateLegacyAttackRolls`), so by the time a response is judged it speaks the
 * engine's dialect regardless of the one the model chose.
 */
function findBreach(response: DMResponse, prompt: string): ContractBreach | null {
  const combatActive = combatIsActiveInPrompt(prompt);
  const transition = validateCombatTransitionContract(response, combatActive);
  if (transition) {
    return {
      contract: 'combat_transition',
      correctivePrompt: buildCombatTransitionCorrectivePrompt(transition),
      detail: { rollTypes: transition.rollTypes },
    };
  }
  const spatial = validateSpatialCombatContract(response, prompt, combatActive);
  if (spatial) {
    return {
      contract: 'spatial',
      correctivePrompt: buildSpatialCorrectivePrompt(spatial),
      detail: {
        kind: spatial.kind,
        actorId: spatial.actorId,
        targetId: spatial.targetId,
        distanceFeet: spatial.distanceFeet,
        movementRemaining: spatial.movementRemaining,
        reason: spatial.message,
      },
    };
  }
  if (combatActive) {
    const kill = killBreach(response, prompt);
    if (kill) return kill;
  }
  return null;
}

export async function enforceCombatTransitionContract(params: {
  result: LLMResponse;
  prompt: string;
  model?: string;
  maxTokens: number;
  temperature: number;
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: 'openrouter' | 'gemini';
  responseSchema?: Record<string, unknown>;
  /** What the player typed this turn; the prose attack floor only reads an attack the player declared. */
  playerInput?: string;
  /**
   * Records an engine fact for the DM's next read (#2563). A deferred scene end must
   * tell the DM the fight is not over, or it keeps narrating the fight as finished
   * while the engine holds it open. Best-effort: a failed write never costs the turn.
   */
  recordTacticalFact?: (fact: string) => Promise<void>;
}): Promise<LLMResponse> {
  const { result, prompt, responseSchema } = params;
  if (result.error || !isDmResponseSchema(responseSchema)) return result;
  const parsed = parseDmResponse(result.text);
  if (!parsed) return result;

  // A deferred end leaves the fight open on the engine while the DM's text said it
  // ended; the refusal fact is how the DM learns that on its next read (#2563), the
  // same fact the end route writes on a 409. Best-effort: never cost the turn.
  const noteDeferredEnd = async (blocking: SceneEndParticipant[]): Promise<void> => {
    if (!params.recordTacticalFact) return;
    try {
      await params.recordTacticalFact(describeSceneEndRefusal(blocking));
    } catch {
      // The deferral itself already protects the player-facing state.
    }
  };

  const combatActive = combatIsActiveInPrompt(prompt);
  // Acceptance before judgement: the response is rewritten into the engine's dialect first,
  // and everything downstream — validation, correction, the text handed back to the client —
  // sees the rewritten form. An attack can no longer fail to resolve because of its envelope.
  const acceptance = acceptWhateverWasEmitted(parsed, prompt, combatActive, params.playerInput);
  let accepted = withAcceptance(result, acceptance);
  const { translation, inference } = acceptance;
  // Declared actions resolve BEFORE the end-of-combat transition is evaluated (#2524).
  // In run D1 the envelope carried `combat_transition: 'end'` on the very turn the
  // player declared "attack it again", and the end pre-empted the attack: no roll ever
  // happened, yet the DM narrated the kill. An envelope that declares actions cannot
  // also end the scene — the end is deferred to a later turn, after the engine has
  // resolved what was declared.
  if (
    combatActive &&
    acceptance.response.combat_transition === 'end' &&
    (acceptance.response.combat_actions ?? []).length > 0
  ) {
    logger.warn({
      msg: 'COMBAT_END_DEFERRED_FOR_DECLARED_ACTIONS',
      alert: true,
      actions: acceptance.response.combat_actions.length,
    });
    const deferred: DMResponse = { ...acceptance.response, combat_transition: 'none' };
    accepted = { ...accepted, text: JSON.stringify(deferred) };
    acceptance.response = deferred;
  }
  // The zero-action shape (#2524 round 2): no actions declared, but the roster still
  // shows a live hostile no exit accounts for. The end is deferred the same way, so
  // the client never flips out of combat and the player's declared attack next gets
  // its guard (`shouldForceCombatAction` stands down on any non-'none' transition).
  if (combatActive && acceptance.response.combat_transition === 'end') {
    const blocking = liveHostilesBlockingEnd(acceptance.response, prompt);
    if (blocking.length) {
      logger.warn({
        msg: 'COMBAT_END_DEFERRED_LIVE_HOSTILE',
        alert: true,
        liveHostiles: blocking.map((participant) => participant.id),
      });
      await noteDeferredEnd(blocking);
      const deferred: DMResponse = { ...acceptance.response, combat_transition: 'none' };
      accepted = { ...accepted, text: JSON.stringify(deferred) };
      acceptance.response = deferred;
    }
  }
  const breach = findBreach(acceptance.response, prompt);

  // A single first-offense hint per encounter teaches the dialect; after that translation is
  // silent. Eleven identical correctives taught run 8's model nothing and cost it every turn.
  const hint =
    translation && !breach && claimFirstOffenseHint(encounterKeyFromPrompt(prompt))
      ? buildLegacyAttackHintPrompt(translation)
      : null;
  if (translation)
    logger.info({
      msg: 'DM_LEGACY_ATTACK_TRANSLATED',
      hinted: !!hint,
      translations: translation.translations.map((entry) => ({
        purpose: entry.purpose,
        action: entry.action,
        fallbacks: entry.fallbacks,
      })),
      untranslated: translation.untranslated,
      // Reason codes only, no prose (#2563): `translations: []` alone could not say
      // whether the rung let go or the model had already declared the attack itself.
      skipped: translation.skipped,
    });
  // The floor firing is never routine: it means both structured channels were empty on a turn
  // that was describing an attack, which is the exact shape of the run 9 regression.
  if (inference)
    logger.warn({
      msg: 'DM_PROSE_ATTACK_INFERRED',
      alert: true,
      actorId: inference.actorId,
      targetId: inference.targetId,
      distanceFeet: inference.distanceFeet,
      action: inference.action,
    });
  if (!breach && !hint) {
    const sanitized = stripKillClaimsFromResponse(acceptance.response, prompt);
    return sanitized === acceptance.response
      ? accepted
      : { ...accepted, text: JSON.stringify(sanitized) };
  }

  if (breach)
    logger.warn({
      msg: 'DM_COMBAT_CONTRACT_CORRECTIVE_REPROMPT',
      alert: true,
      contract: breach.contract,
      ...breach.detail,
    });
  const retry = await LLMProviderService.generate({
    prompt: breach ? breach.correctivePrompt : hint!,
    model: params.model,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    history: [
      ...(params.history || []),
      { role: 'user', content: prompt },
      { role: 'assistant', content: result.text },
    ],
    provider: params.provider,
    responseSchema,
  });
  if (retry.error) {
    logger.error({
      msg: '!!!!!!!!!!!!!!!! DM_COMBAT_CONTRACT_CORRECTION_FAILED !!!!!!!!!!!!!!!!',
      alert: true,
      error: retry.error,
      contract: breach?.contract ?? 'legacy_attack_hint',
      ...(breach?.detail ?? {}),
    });
    // The already-translated response is what goes back, never the raw one: a failed retry
    // must not cost the table the attacks the server already understood. Kill claims are
    // stripped on this path too, whatever contract triggered the correction (#2524).
    const sanitized = stripKillClaimsFromResponse(acceptance.response, prompt);
    return sanitized === acceptance.response
      ? accepted
      : { ...accepted, text: JSON.stringify(sanitized) };
  }

  const retryParsed = parseDmResponse(retry.text);
  // The retry gets the same acceptance the first response did. A model that answers a hint by
  // writing the old dialect again is translated again, silently; one that answers in prose is
  // read out of its prose again.
  const retryAcceptance = retryParsed
    ? acceptWhateverWasEmitted(retryParsed, prompt, combatActive, params.playerInput)
    : null;
  let retryAccepted = retryAcceptance ? withAcceptance(retry, retryAcceptance) : retry;
  if (
    retryAcceptance &&
    combatActive &&
    retryAcceptance.response.combat_transition === 'end' &&
    (retryAcceptance.response.combat_actions ?? []).length > 0
  ) {
    const deferred: DMResponse = {
      ...retryAcceptance.response,
      combat_transition: 'none',
    };
    retryAcceptance.response = deferred;
    retryAccepted = { ...retryAccepted, text: JSON.stringify(deferred) };
  }
  if (retryAcceptance && combatActive && retryAcceptance.response.combat_transition === 'end') {
    const blocking = liveHostilesBlockingEnd(retryAcceptance.response, prompt);
    if (blocking.length) {
      logger.warn({
        msg: 'COMBAT_END_DEFERRED_LIVE_HOSTILE',
        alert: true,
        liveHostiles: blocking.map((participant) => participant.id),
      });
      await noteDeferredEnd(blocking);
      const deferred: DMResponse = { ...retryAcceptance.response, combat_transition: 'none' };
      retryAcceptance.response = deferred;
      retryAccepted = { ...retryAccepted, text: JSON.stringify(deferred) };
    }
  }
  const retryBreach = retryAcceptance ? findBreach(retryAcceptance.response, prompt) : null;
  if (retryBreach) {
    // Telemetry over deadlock: one correction is the whole budget, so a second violation is
    // logged loudly and the turn is allowed through rather than stalling the table.
    logger.error({
      msg: '!!!!!!!!!!!!!!!! DM_COMBAT_CONTRACT_VIOLATION_PASSTHROUGH !!!!!!!!!!!!!!!!',
      alert: true,
      contract: retryBreach.contract,
      ...retryBreach.detail,
      provider: retry.provider,
      model: retry.model,
    });
  }
  if (retryAcceptance) {
    // Whatever the retry breached, a kill claim about a living participant does not
    // pass through (#2524): strip the sentences and withdraw the end with them.
    const sanitized = stripKillClaimsFromResponse(retryAcceptance.response, prompt);
    if (sanitized !== retryAcceptance.response) {
      return {
        ...retryAccepted,
        text: JSON.stringify(sanitized),
        usage: combineUsage(result, retry),
      };
    }
  } else {
    // An unparseable retry cannot be judged, so its raw text is never handed back
    // unchecked (#2524): fall back to the accepted first response, sanitized.
    const sanitized = stripKillClaimsFromResponse(acceptance.response, prompt);
    return {
      ...accepted,
      text: JSON.stringify(sanitized),
      usage: combineUsage(result, retry),
    };
  }
  return { ...retryAccepted, usage: combineUsage(result, retry) };
}
