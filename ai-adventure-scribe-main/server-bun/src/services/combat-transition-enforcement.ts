import { LLMProviderService, type LLMResponse } from './llm-provider-service.js';
import { logger } from '../lib/logger.js';
import {
  buildCombatTransitionCorrectivePrompt,
  validateCombatTransitionContract,
} from '../tactical/dispatch.js';
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

type ContractBreach = {
  contract: 'combat_transition' | 'spatial';
  correctivePrompt: string;
  detail: Record<string, unknown>;
};

/**
 * Both combat contracts are checked against the same response. The transition contract runs
 * first because a response that has not legally entered combat has no board to be coherent with.
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
  const breach = findBreach(parsed, prompt);
  if (!breach) return result;

  logger.warn({
    msg: 'DM_COMBAT_CONTRACT_CORRECTIVE_REPROMPT',
    alert: true,
    contract: breach.contract,
    ...breach.detail,
  });
  const retry = await LLMProviderService.generate({
    prompt: breach.correctivePrompt,
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
      contract: breach.contract,
      ...breach.detail,
    });
    return result;
  }

  const retryParsed = parseDmResponse(retry.text);
  const retryBreach = retryParsed ? findBreach(retryParsed, prompt) : null;
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
  return { ...retry, usage: combineUsage(result, retry) };
}
