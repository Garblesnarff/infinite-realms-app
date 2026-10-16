/**
 * Provider key/credit-limit detection and alerting (#350).
 *
 * On 2026-10-10 the OpenRouter key hit its total spend cap (upstream 403
 * "Key limit exceeded") and every DM turn degraded for ~22 h before anyone
 * noticed: the chain-exhausted log line carried no distinct code and nothing
 * paged. This module answers "is this failure a dead provider key?" so the
 * chain-exhaustion path can log a distinct code and fire the ops alert path.
 *
 * Detection is deliberately narrow: an upstream auth/limit status
 * (401/402/403) or a "limit"/"credit" message on a non-429, non-5xx status.
 * A 403 alone is enough. Anything broader (e.g. all 4xx) would page on caller
 * errors like a bad model name; matching the message on 429 would page on
 * rate limiting (a slowdown, not a dead key); matching it on 5xx would page
 * on upstream HTML error pages — or on local validation text, which must
 * never feed this verdict (#350 FIX round 2).
 *
 * The verdict is computed ONCE per chain-exhausted event, from the raw
 * upstream status + body OR'd across every model attempt, and carried on the
 * result as `providerKeyLimit` — the alert and the route both honor that
 * single verdict, so they can never disagree about what happened. (An
 * earlier shape let the alert see the raw body while the route saw only the
 * production-stripped result.)
 */
import { alert } from '../lib/alerting.js';
import { logger } from '../lib/logger.js';

/** Distinct log code for a chain exhausted by a provider key/credit limit. */
const LLM_PROVIDER_KEY_LIMIT_CODE = 'LLM_PROVIDER_KEY_LIMIT';

/** Alert kind for the ops alert path. */
export const KEY_LIMIT_ALERT_KIND = 'llm_provider_key_limit';

/**
 * The key-limit page fires at most once per window. 15 minutes is long enough
 * that a hot failure loop pages once, short enough that a genuinely new
 * outage after the first page is not silent for hours (#350).
 */
export const KEY_LIMIT_ALERT_WINDOW_MS = 15 * 60 * 1000;

const KEY_LIMIT_STATUSES: ReadonlySet<number> = new Set([401, 402, 403]);
const KEY_LIMIT_MESSAGE_PATTERN = /limit|credit/i;

export interface KeyLimitSignal {
  upstreamStatus?: number | null;
  details?: string | null;
}

/**
 * True when an upstream failure looks like a provider key or credit limit:
 * an auth/limit status (401/402/403), or a "limit"/"credit" message on a
 * non-429, non-5xx upstream status.
 *
 * The message pattern (/limit|credit/i) is broad by design — it also matches
 * 429 "Rate limit exceeded" and Gemini 429 "Quota exceeded … limit" — so it
 * only applies where a message can actually describe a dead key. A 429 is
 * rate limiting, not a dead key; 5xx bodies are upstream HTML/error pages or
 * local validation text fed from the service, and must never mark the chain
 * as key-limit (that would page, show the maintenance message, refund quota,
 * and fake later 403s via providerKeyLimitActive).
 */
export function isProviderKeyLimitError(result: KeyLimitSignal): boolean {
  const status = result.upstreamStatus;
  if (typeof status === 'number' && KEY_LIMIT_STATUSES.has(status)) {
    return true;
  }
  if (typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599))) {
    return false;
  }
  return typeof result.details === 'string' && KEY_LIMIT_MESSAGE_PATTERN.test(result.details);
}

/**
 * Log the distinct code and fire the existing ops alert path (once per
 * 15 minutes). Carries no key values and no user data: provider name and
 * upstream status only. Never throws — a failure here must not become a
 * failure in the turn that triggered it.
 */
export function alertProviderKeyLimit(
  result: KeyLimitSignal & { provider?: string },
): void {
  const provider = result.provider ?? 'unknown';
  const upstreamStatus = result.upstreamStatus ?? null;
  try {
    logger.error({
      msg: LLM_PROVIDER_KEY_LIMIT_CODE,
      provider,
      upstreamStatus,
    });
  } catch {
    // The turn must never fail because logging did.
  }
  try {
    alert(
      KEY_LIMIT_ALERT_KIND,
      { error: `provider=${provider} upstream_status=${upstreamStatus ?? 'unknown'}` },
      { windowMs: KEY_LIMIT_ALERT_WINDOW_MS },
    );
  } catch {
    // alert() is non-throwing by contract; this is belt and suspenders.
  }
}
