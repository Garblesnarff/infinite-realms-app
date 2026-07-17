import type { LLMResponse } from './llm-provider-service.js';

export const isRetryableUpstreamStatus = (status: number): boolean =>
  status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;

export class LLMUpstreamError extends Error {
  constructor(
    public readonly provider: 'openrouter' | 'gemini',
    public readonly model: string,
    public readonly upstreamStatus: number,
    message: string,
  ) {
    super(message);
    this.name = 'LLMUpstreamError';
  }

  get retryable(): boolean {
    return isRetryableUpstreamStatus(this.upstreamStatus);
  }
}

export interface UpstreamModelErrorBody {
  error: 'upstream_model_error';
  provider: 'openrouter' | 'gemini';
  model: string;
  upstreamStatus: number;
  retryable: boolean;
}

export const createUpstreamModelErrorBody = (
  provider: 'openrouter' | 'gemini',
  model: string,
  upstreamStatus: number,
  retryable = isRetryableUpstreamStatus(upstreamStatus),
): UpstreamModelErrorBody => ({
  error: 'upstream_model_error',
  provider,
  model,
  upstreamStatus,
  retryable,
});

export const toUpstreamModelError = (result: LLMResponse): UpstreamModelErrorBody | null => {
  if (!result.upstreamStatus || !result.provider || !result.model) return null;
  return createUpstreamModelErrorBody(
    result.provider,
    result.model,
    result.upstreamStatus,
    result.retryable,
  );
};
