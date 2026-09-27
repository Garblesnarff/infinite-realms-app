import { INPUT_TOKEN_CAP, USD_PER_INPUT_TOKEN } from './decisions-types';

import type { DecisionsUsage } from './decisions-types';

export class CostCapError extends Error {
  constructor(
    readonly used: number,
    readonly estimate: number,
    readonly cap: number,
  ) {
    super(
      `Input-token cap reached: used ${used} + estimate ${estimate} would pass ${cap}. No further request was sent.`,
    );
    this.name = 'CostCapError';
  }
}

/**
 * Conservative token estimate (about 3 characters per token) so the cap
 * trips before a request, not after the bill.
 */
export function estimateInputTokens(body: unknown): number {
  const json = JSON.stringify(body);
  return Math.max(1, Math.ceil(json.length / 3));
}

export function costUsdFromUsage(usage: DecisionsUsage): number {
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
    return usage.cost;
  }
  return usage.input_tokens * USD_PER_INPUT_TOKEN;
}

/** Hard stop at 2,000,000 input tokens (about $0.08 at the published rate). */
export class CostLedger {
  inputTokens = 0;
  outputTokens = 0;
  costUsd = 0;
  requests = 0;

  constructor(readonly cap: number = INPUT_TOKEN_CAP) {}

  assertCanSpend(estimate: number): void {
    if (this.inputTokens + estimate > this.cap) {
      throw new CostCapError(this.inputTokens, estimate, this.cap);
    }
  }

  /** Count a reservation when the provider returns no usage (failures, retries). */
  reserve(estimate: number): void {
    this.assertCanSpend(estimate);
    this.inputTokens += estimate;
    this.costUsd += estimate * USD_PER_INPUT_TOKEN;
  }

  /** Replace a reservation with the provider's usage, if it sent one. */
  settle(reservedEstimate: number, usage: DecisionsUsage): void {
    this.inputTokens -= reservedEstimate;
    this.costUsd -= reservedEstimate * USD_PER_INPUT_TOKEN;
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    this.costUsd += costUsdFromUsage(usage);
    this.requests += 1;
  }
}
