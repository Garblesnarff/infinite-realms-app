export interface AutoPlayable {
  pendingRolls: readonly unknown[];
  roll(): { result: { total: number } };
  play(input: string, roll?: unknown): Promise<{ provider?: string; model?: string } | unknown>;
}

export interface AutoTurnOptions {
  delayMs?: number;
  maxRetries?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export interface AutoTurnSummary {
  turnsCompleted: number;
  rollsMade: number;
  contractViolations: number;
  providerCounts: Record<string, number>;
  providerModelCounts: Record<string, number>;
}

const isRetryable = (error: unknown): error is { retryable: boolean; retryAfterMs?: number } =>
  typeof error === 'object' && error !== null && (error as { retryable?: unknown }).retryable === true;

const telemetryFrom = (result: unknown): { provider?: string; model?: string } =>
  typeof result === 'object' && result !== null ? result as { provider?: string; model?: string } : {};

export async function runAutoTurns(
  client: AutoPlayable,
  turns: number,
  onError: (error: unknown) => void,
  options: AutoTurnOptions = {},
): Promise<AutoTurnSummary> {
  const delayMs = Math.max(0, options.delayMs ?? 2_000);
  const maxRetries = Math.max(0, Math.min(2, options.maxRetries ?? 2));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let turnsCompleted = 0;
  let rollsMade = 0;
  let contractViolations = 0;
  const providerCounts: Record<string, number> = {};
  const providerModelCounts: Record<string, number> = {};
  for (let turn = 0; turn < turns; turn += 1) {
    const roll = client.pendingRolls.length ? client.roll() : undefined;
    const input = roll
      ? `I rolled ${roll.result.total}.`
      : `I choose a careful, proactive course of action (${turn + 1}).`;
    let attempt = 0;
    try {
      while (true) {
        try {
          const telemetry = telemetryFrom(await client.play(input, roll));
          if (telemetry.provider) {
            providerCounts[telemetry.provider] = (providerCounts[telemetry.provider] || 0) + 1;
            const providerModel = `${telemetry.provider}/${telemetry.model || 'unknown'}`;
            providerModelCounts[providerModel] = (providerModelCounts[providerModel] || 0) + 1;
          }
          if (roll) rollsMade += 1;
          turnsCompleted += 1;
          break;
        } catch (error) {
          if (!isRetryable(error) || attempt >= maxRetries) throw error;
          const backoffMs = Math.max(error.retryAfterMs || 0, delayMs * 2 ** attempt);
          attempt += 1;
          await sleep(backoffMs);
        }
      }
    } catch (error) {
      contractViolations += 1;
      onError(error);
    }
  }
  return { turnsCompleted, rollsMade, contractViolations, providerCounts, providerModelCounts };
}
