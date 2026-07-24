import { LLMProviderService, type LLMResponse } from './llm-provider-service.js';
import { logger } from '../lib/logger.js';
import {
  buildCombatTransitionCorrectivePrompt,
  validateCombatTransitionContract,
} from '../tactical/dispatch.js';

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
  const violation = validateCombatTransitionContract(parsed, combatIsActiveInPrompt(prompt));
  if (!violation) return result;

  logger.warn({
    msg: 'DM_COMBAT_TRANSITION_CONTRACT_CORRECTIVE_REPROMPT',
    alert: true,
    rollTypes: violation.rollTypes,
  });
  const retry = await LLMProviderService.generate({
    prompt: buildCombatTransitionCorrectivePrompt(violation),
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
      msg: '!!!!!!!!!!!!!!!! DM_COMBAT_TRANSITION_CORRECTION_FAILED !!!!!!!!!!!!!!!!',
      alert: true,
      error: retry.error,
      rollTypes: violation.rollTypes,
    });
    return result;
  }

  const retryParsed = parseDmResponse(retry.text);
  const retryViolation = retryParsed
    ? validateCombatTransitionContract(retryParsed, combatIsActiveInPrompt(prompt))
    : null;
  if (retryViolation) {
    logger.error({
      msg: '!!!!!!!!!!!!!!!! DM_COMBAT_TRANSITION_CONTRACT_VIOLATION_PASSTHROUGH !!!!!!!!!!!!!!!!',
      alert: true,
      rollTypes: retryViolation.rollTypes,
      provider: retry.provider,
      model: retry.model,
    });
  }
  return { ...retry, usage: combineUsage(result, retry) };
}
