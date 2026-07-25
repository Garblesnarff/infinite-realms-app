/**
 * Consecutive identical hard failures that end an auto-play run. Retrying a deterministic
 * server failure (a 500 on every combat start, say) just burns LLM calls and fills the
 * transcript with the same line; three is enough to establish it is not transient.
 */
export const IDENTICAL_FAILURE_LIMIT = 3;

/**
 * Identity of a failure, for "is this the same thing again?". Errors that expose a
 * `fingerprint` (CombatStartError) define their own; everything else falls back to
 * name + message.
 */
export function failureFingerprint(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { fingerprint?: unknown; name?: unknown; message?: unknown };
    if (typeof candidate.fingerprint === 'string') return candidate.fingerprint;
    if (typeof candidate.message === 'string') {
      return `${String(candidate.name)}:${candidate.message}`;
    }
  }
  return String(error);
}

/** Tracks how many times in a row the same failure has come back. */
export class FailureStreak {
  private fingerprint: string | null = null;
  private count = 0;

  /** Records a failure; returns the run-ending verdict once the limit is reached. */
  record(error: unknown): { exhausted: boolean; verdict?: string } {
    const fingerprint = failureFingerprint(error);
    this.count = fingerprint === this.fingerprint ? this.count + 1 : 1;
    this.fingerprint = fingerprint;
    if (this.count < IDENTICAL_FAILURE_LIMIT) return { exhausted: false };
    return {
      exhausted: true,
      verdict:
        `Stopped after ${this.count} identical consecutive failures: ${fingerprint}. ` +
        'This is a hard, repeatable failure — the remaining turns were not attempted.',
    };
  }

  reset(): void {
    this.fingerprint = null;
    this.count = 0;
  }
}
