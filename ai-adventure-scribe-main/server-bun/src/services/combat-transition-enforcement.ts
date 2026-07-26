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
  contract: 'combat_transition' | 'spatial';
  correctivePrompt: string;
  detail: Record<string, unknown>;
};

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
}): Promise<LLMResponse> {
  const { result, prompt, responseSchema } = params;
  if (result.error || !isDmResponseSchema(responseSchema)) return result;
  const parsed = parseDmResponse(result.text);
  if (!parsed) return result;

  const combatActive = combatIsActiveInPrompt(prompt);
  // Acceptance before judgement: the response is rewritten into the engine's dialect first,
  // and everything downstream — validation, correction, the text handed back to the client —
  // sees the rewritten form. An attack can no longer fail to resolve because of its envelope.
  const acceptance = acceptWhateverWasEmitted(parsed, prompt, combatActive);
  const accepted = withAcceptance(result, acceptance);
  const { translation, inference } = acceptance;
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
  if (!breach && !hint) return accepted;

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
    // must not cost the table the attacks the server already understood.
    return accepted;
  }

  const retryParsed = parseDmResponse(retry.text);
  // The retry gets the same acceptance the first response did. A model that answers a hint by
  // writing the old dialect again is translated again, silently; one that answers in prose is
  // read out of its prose again.
  const retryAcceptance = retryParsed
    ? acceptWhateverWasEmitted(retryParsed, prompt, combatActive)
    : null;
  const retryAccepted = retryAcceptance ? withAcceptance(retry, retryAcceptance) : retry;
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
  return { ...retryAccepted, usage: combineUsage(result, retry) };
}
