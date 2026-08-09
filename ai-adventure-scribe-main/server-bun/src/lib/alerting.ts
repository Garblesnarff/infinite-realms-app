/**
 * Loud, fire-and-forget alerting for continuity-path failures.
 *
 * Every continuity failure up to this point (a narrative write that silently no-ops, a
 * scene-state fetch that returns null, a lore injection that logs a warning nobody reads)
 * was indistinguishable in production from the same code path succeeding. `alert()` is the
 * one place that turns "logged and moved on" into "logged and somebody was told."
 *
 * Two guarantees this module exists to keep:
 *  - It never throws, and it never hands the caller a promise to await. A failure in the
 *    alert path must never become a failure in the game turn that triggered it.
 *  - The structured `[ALERT] ...` log line is unconditional. The Slack webhook is best-effort
 *    and rate-limited per kind (max one POST per kind per 60s) so a hot failure loop produces
 *    one page, not a flood — but the log line, which costs nothing and never spams anyone's
 *    phone, is written every time.
 *
 * Reuses the `SLACK_ALERT_WEBHOOK_URL` env var and the `{ text }` payload shape already used
 * by `ops/auto-deploy.sh`'s deploy-smoke-failure alert, per the owner decision on issue #1680.
 */
import { logger } from './logger.js';

export interface AlertDetail {
  sessionId?: string;
  error?: string;
}

const RATE_LIMIT_WINDOW_MS = 60_000;

/** Last webhook POST time per alert kind, so a hot failure loop pages once, not repeatedly. */
const lastWebhookPostAtByKind = new Map<string, number>();

const formatAlertLine = (kind: string, detail: AlertDetail): string =>
  `[ALERT] kind=${kind} session=${detail.sessionId ?? 'unknown'} error=${detail.error ?? 'none'}`;

/** True (and records `now`) the first time a kind is seen in a 60s window; false after. */
function withinRateLimit(kind: string, now: number): boolean {
  const lastPostAt = lastWebhookPostAtByKind.get(kind);
  if (lastPostAt !== undefined && now - lastPostAt < RATE_LIMIT_WINDOW_MS) {
    return false;
  }
  lastWebhookPostAtByKind.set(kind, now);
  return true;
}

/**
 * Best-effort Slack-webhook-format POST. Never awaited by the caller: the returned promise
 * is caught internally and voided so a slow or failing webhook can never delay or throw into
 * whatever called `alert()`.
 */
function postToWebhook(kind: string, detail: AlertDetail, line: string): void {
  const webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  if (!withinRateLimit(kind, Date.now())) return;

  const request = fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: line }),
  }).catch((error: unknown) => {
    logger.warn({
      msg: 'ALERT_WEBHOOK_POST_FAILED',
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  // Explicitly discarded: a webhook failure must never surface as an unhandled rejection,
  // and this function must never return anything the caller could accidentally await.
  void request;
}

/**
 * Report a continuity-path failure. Always writes one structured log line; also fires a
 * rate-limited, best-effort Slack alert when `SLACK_ALERT_WEBHOOK_URL` is configured.
 *
 * Synchronous and side-effect-only by contract: callers keep their existing degraded-but-safe
 * behavior exactly as before, and just add `alert(...)` alongside it.
 */
export function alert(kind: string, detail: AlertDetail = {}): void {
  const line = formatAlertLine(kind, detail);
  try {
    logger.warn(line);
  } catch {
    // Logging itself must not be able to throw into the caller's path either.
  }

  try {
    postToWebhook(kind, detail, line);
  } catch (error) {
    try {
      logger.warn({
        msg: 'ALERT_DISPATCH_FAILED',
        kind,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      /* last resort: swallow — alert() must never throw. */
    }
  }
}
