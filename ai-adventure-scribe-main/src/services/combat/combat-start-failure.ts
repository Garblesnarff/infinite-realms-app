/**
 * A combat-start rejection carrying everything needed to diagnose it after the fact: the DM
 * envelope that produced it, the server's response body, and the pipeline stage that failed.
 *
 * Previously a failed start threw `Error("Structured combat start failed (500)")` — a status
 * code and nothing else — so a transcript of a broken run contained no trace of what the DM
 * had actually asked for.
 */
export type CombatStartStage =
  | 'ownership'
  | 'participants'
  | 'map_generation'
  | 'persistence'
  | 'unknown';

export class CombatStartError extends Error {
  readonly category = 'transport';
  readonly name = 'CombatStartError';

  constructor(
    readonly status: number,
    readonly stage: CombatStartStage,
    readonly detail: string,
    readonly responseBody: string,
    readonly envelope: unknown,
  ) {
    super(`Structured combat start failed (${status}, stage: ${stage}): ${detail}`);
  }

  /** Stable identity for "the same hard failure happened again". */
  get fingerprint(): string {
    return `combat_start:${this.status}:${this.stage}:${this.detail}`;
  }

  /** Everything a transcript should record about this failure. */
  toTranscriptDetail(): Record<string, unknown> {
    return {
      kind: 'combat_start_failure',
      status: this.status,
      stage: this.stage,
      detail: this.detail,
      responseBody: this.responseBody,
      dmEnvelope: this.envelope,
    };
  }
}

/** Builds a CombatStartError from a non-ok response, reading the body at most once. */
export async function combatStartErrorFromResponse(
  response: Response | null,
  envelope: unknown,
): Promise<CombatStartError> {
  if (!response) {
    return new CombatStartError(0, 'unknown', 'no response from server', '', envelope);
  }
  const responseBody = await response.text().catch(() => '');
  let stage: CombatStartStage = 'unknown';
  let detail = responseBody.slice(0, 500) || response.statusText || 'unknown failure';
  try {
    const parsed = JSON.parse(responseBody) as { stage?: string; detail?: string; error?: string };
    if (parsed.stage) stage = parsed.stage as CombatStartStage;
    if (parsed.detail || parsed.error) detail = String(parsed.detail || parsed.error);
  } catch {
    // Non-JSON body (proxy error page, empty 502): keep the raw text as the detail.
  }
  return new CombatStartError(response.status, stage, detail, responseBody, envelope);
}
