export interface AutoPlayable {
  pendingRolls: readonly unknown[];
  availableOptions: readonly string[];
  roll(): unknown;
  play(
    input: string,
    rolls?: readonly unknown[],
  ): Promise<{ provider?: string; model?: string } | unknown>;
}

export type Persona = 'careful' | 'aggressive' | 'chaotic';

export interface AutoTurnOptions {
  delayMs?: number;
  maxRetries?: number;
  sleep?: (delayMs: number) => Promise<void>;
  persona?: Persona;
  random?: () => number;
}

export interface AutoTurnSummary {
  turnsCompleted: number;
  turnsFailed: number;
  rollsMade: number;
  contractViolations: number;
  transportErrors: number;
  providerCounts: Record<string, number>;
  providerModelCounts: Record<string, number>;
}

const isRetryable = (error: unknown): error is { retryable: boolean; retryAfterMs?: number } =>
  typeof error === 'object' &&
  error !== null &&
  (error as { retryable?: unknown }).retryable === true;

const telemetryFrom = (result: unknown): { provider?: string; model?: string } =>
  typeof result === 'object' && result !== null
    ? (result as { provider?: string; model?: string })
    : {};

const skippedRollFrom = (result: unknown): { skipped: true; error: unknown } | null =>
  typeof result === 'object' &&
  result !== null &&
  (result as { skipped?: unknown }).skipped === true
    ? (result as { skipped: true; error: unknown })
    : null;

const PERSONA_TERMS: Record<Persona, RegExp> = {
  careful:
    /\b(?:careful|cautious|quiet|observe|inspect|investigate|listen|ask|negotiate|prepare|stealth|survey|study|wait)\b/i,
  aggressive:
    /\b(?:attack|charge|fight|strike|threaten|confront|challenge|force|break|kick|weapon|combat|ambush|intimidat|pursue)\w*/i,
  chaotic:
    /\b(?:wild|strange|unexpected|unconventional|improvise|gamble|chaos|random|reckless|steal|disguise|trick|magic|fire|leap)\w*/i,
};

const FREE_TEXT: Record<Persona, readonly string[]> = {
  careful: [
    'I slow down, study the situation for danger, and take the safest useful next step.',
    'I gather more information and proceed cautiously without giving away my position.',
  ],
  aggressive: [
    'I confront the nearest threat directly and press the situation toward a fight.',
    'I draw my weapon, challenge whoever stands in my way, and force the conflict into the open.',
  ],
  chaotic: [
    'I try the strangest plausible move available and embrace whatever trouble it causes.',
    'I improvise a reckless wildcard plan that nobody in the scene expects.',
  ],
};

function randomIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

export function selectAutoAction(
  options: readonly string[],
  persona: Persona | undefined,
  random: () => number = Math.random,
): string {
  if (options.length) {
    if (!persona) return options[randomIndex(options.length, random)];
    const preferred = options.filter((option) => PERSONA_TERMS[persona].test(option));
    const pool = preferred.length ? preferred : options;
    return pool[randomIndex(pool.length, random)];
  }

  const fallbackPersona = persona || 'careful';
  const choices = FREE_TEXT[fallbackPersona];
  return choices[randomIndex(choices.length, random)];
}

function isContractViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { category?: unknown }).category === 'contract' ||
      (error as { name?: unknown }).name === 'ContractViolationError')
  );
}

function isTransportError(error: unknown): boolean {
  if (error instanceof TypeError && /\bfetch\b/i.test(error.message)) return true;
  if (
    error instanceof Error &&
    /\b(?:API|HTTP|status|failed)\D{0,20}[45]\d\d\b/i.test(error.message)
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { category?: unknown }).category === 'transport' ||
      (error as { name?: unknown }).name === 'ApiClientError' ||
      typeof (error as { status?: unknown }).status === 'number')
  );
}

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
  let turnsFailed = 0;
  let rollsMade = 0;
  let contractViolations = 0;
  let transportErrors = 0;
  const providerCounts: Record<string, number> = {};
  const providerModelCounts: Record<string, number> = {};
  for (let turn = 0; turn < turns; turn += 1) {
    const rolls: unknown[] = [];
    let skippedUnresolvableRoll = false;
    try {
      const pendingRollCount = client.pendingRolls.length;
      for (let index = 0; index < pendingRollCount; index += 1) {
        const roll = client.roll();
        const skipped = skippedRollFrom(roll);
        if (skipped) {
          skippedUnresolvableRoll = true;
          contractViolations += 1;
          onError(skipped.error);
        } else {
          rolls.push(roll);
        }
      }
      rollsMade += rolls.length;
      const input = skippedUnresolvableRoll
        ? 'I attempt it.'
        : rolls.length
          ? `I completed all ${rolls.length} pending roll${rolls.length === 1 ? '' : 's'}.`
          : selectAutoAction(client.availableOptions, options.persona, options.random);
      let attempt = 0;
      while (true) {
        try {
          const telemetry = telemetryFrom(
            await client.play(input, rolls.length ? rolls : undefined),
          );
          if (telemetry.provider) {
            providerCounts[telemetry.provider] = (providerCounts[telemetry.provider] || 0) + 1;
            const providerModel = `${telemetry.provider}/${telemetry.model || 'unknown'}`;
            providerModelCounts[providerModel] = (providerModelCounts[providerModel] || 0) + 1;
          }
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
      turnsFailed += 1;
      if (isContractViolation(error)) contractViolations += 1;
      if (isTransportError(error)) transportErrors += 1;
      onError(error);
    }
  }
  return {
    turnsCompleted,
    turnsFailed,
    rollsMade,
    contractViolations,
    transportErrors,
    providerCounts,
    providerModelCounts,
  };
}
