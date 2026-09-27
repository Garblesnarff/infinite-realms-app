import { estimateInputTokens } from './cost-ledger';
import { DECISIONS_URL, JEV_MODEL } from './decisions-types';
import { redactSecret } from './redact';
import { assertDecisionsRequest } from './validate-request';

import type { CostLedger } from './cost-ledger';
import type {
  DecisionAnswer,
  DecisionsRequest,
  DecisionsResponse,
  DecisionsUsage,
} from './decisions-types';

const RETRYABLE = new Set([408, 429, 500, 502, 503, 524, 529]);

export class DecisionsHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DecisionsHttpError';
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type DecisionsClientOptions = {
  apiKey: string;
  ledger: CostLedger;
  fetchImpl?: FetchLike;
  model?: string;
  endpoint?: string;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseUsage(value: unknown): DecisionsUsage {
  if (!isRecord(value)) {
    throw new DecisionsHttpError('Response missing usage', 200, false);
  }
  const input = value.input_tokens;
  const output = value.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') {
    throw new DecisionsHttpError('Response usage is missing token counts', 200, false);
  }
  const cost = value.cost;
  return {
    input_tokens: input,
    output_tokens: output,
    cost: typeof cost === 'number' ? cost : undefined,
  };
}

function parseAnswer(value: unknown): DecisionAnswer {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new DecisionsHttpError('Response answer is missing type', 200, false);
  }
  if (value.type === 'noul' && typeof value.noul === 'number') {
    return { type: 'noul', noul: value.noul };
  }
  if (value.type === 'choice' && typeof value.choice === 'string') {
    return {
      type: 'choice',
      choice: value.choice,
      confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
      probabilities: isRecord(value.probabilities)
        ? (value.probabilities as Record<string, number>)
        : undefined,
    };
  }
  if (value.type === 'score' && typeof value.score === 'number') {
    return {
      type: 'score',
      score: value.score,
      confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
      probabilities: isRecord(value.probabilities)
        ? (value.probabilities as Record<string, number>)
        : undefined,
      legend: isRecord(value.legend) ? (value.legend as Record<string, string>) : undefined,
    };
  }
  throw new DecisionsHttpError(`Unexpected answer type ${String(value.type)}`, 200, false);
}

export function parseDecisionsResponse(payload: unknown): DecisionsResponse {
  if (!isRecord(payload)) {
    throw new DecisionsHttpError('Response was not an object', 200, false);
  }
  if (typeof payload.model !== 'string' || !isRecord(payload.answers)) {
    throw new DecisionsHttpError('Response missing model or answers', 200, false);
  }
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, answer] of Object.entries(payload.answers)) {
    answers[name] = parseAnswer(answer);
  }
  return {
    id: typeof payload.id === 'string' ? payload.id : undefined,
    model: payload.model,
    provider: typeof payload.provider === 'string' ? payload.provider : undefined,
    answers,
    usage: parseUsage(payload.usage),
  };
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class DecisionsClient {
  private readonly apiKey: string;
  private readonly ledger: CostLedger;
  private readonly fetchImpl: FetchLike;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: DecisionsClientOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('OPENROUTER_API_KEY is empty');
    }
    this.apiKey = options.apiKey.trim();
    this.ledger = options.ledger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.model = options.model ?? JEV_MODEL;
    this.endpoint = options.endpoint ?? DECISIONS_URL;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async decide(
    input: Omit<DecisionsRequest, 'model'> & { model?: string },
  ): Promise<DecisionsResponse> {
    const request: DecisionsRequest = { ...input, model: input.model ?? this.model };
    assertDecisionsRequest(request);
    if (this.endpoint.includes('/chat/completions')) {
      throw new DecisionsHttpError('Jev must not be sent to the chat endpoint', 0, false);
    }
    const estimate = estimateInputTokens(request);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      this.ledger.reserve(estimate);
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });
        const text = await response.text();
        if (!response.ok) {
          const retryable = RETRYABLE.has(response.status);
          throw new DecisionsHttpError(
            redactSecret(`Decisions API ${response.status}: ${text.slice(0, 500)}`, this.apiKey),
            response.status,
            retryable,
          );
        }
        const parsed = parseDecisionsResponse(JSON.parse(text) as unknown);
        this.ledger.settle(estimate, parsed.usage);
        return parsed;
      } catch (error) {
        const wrapped =
          error instanceof DecisionsHttpError
            ? error
            : new DecisionsHttpError(
                redactSecret(
                  error instanceof Error ? error.message : 'request failed',
                  this.apiKey,
                ),
                0,
                false,
              );
        lastError = wrapped;
        if (!wrapped.retryable || attempt === this.maxAttempts) {
          throw wrapped;
        }
        await this.sleep(200 * attempt);
      }
    }
    throw lastError ?? new DecisionsHttpError('request failed', 0, false);
  }
}

export function readApiKey(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.OPENROUTER_API_KEY;
  if (!value || !value.trim()) {
    return null;
  }
  return value.trim();
}
