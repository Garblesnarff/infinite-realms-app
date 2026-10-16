/**
 * Decide whether a play run hit one of the FAIL rules and, if so, return the
 * reason to print as `RESULT: FAIL <reason>`. Pure so it can be unit tested
 * without a live server.
 */
export interface FailError {
  status?: number;
  message?: string;
}

export interface FailSummary {
  verdict?: string;
  turnsFailed?: number;
}

export interface FailVerdictInput {
  errors: readonly FailError[];
  summary?: FailSummary;
}

const SERVER_ERROR = /\b5\d\d\b/;

function serverErrorReason(error: FailError): string | null {
  if (typeof error.status === 'number' && error.status >= 500) {
    return error.message ? `server error: ${error.message}` : `server error ${error.status}`;
  }
  return SERVER_ERROR.test(error.message ?? '') ? `server error: ${error.message}` : null;
}

export function failVerdict({ errors, summary }: FailVerdictInput): string | null {
  if (summary?.verdict) return summary.verdict;
  for (const error of errors) {
    const reason = serverErrorReason(error);
    if (reason) return reason;
  }
  if (summary && (summary.turnsFailed ?? 0) > 0) return 'lost turn';
  return null;
}
