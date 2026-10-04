/**
 * Telemetry Routes for Elysia
 *
 * POST /v1/telemetry/client-failure
 *
 * The client-side counterpart to `server-bun/src/lib/alerting.ts`: continuity failures that
 * only the browser can see (a lore fetch that failed, a scene-state fetch that came back
 * null) are reported here so they page through the same `alert()` path as server-side
 * failures, instead of dying in a `console.warn` nobody watches.
 *
 * Every accepted report is also written to the server log at info level
 * (`msg: 'CLIENT_FAILURE'`) with the session id and the failure fields, so the next
 * "the client posted a failure at 12:04:07Z" readout can be answered from the log alone
 * instead of the request line, which records only route and status (#2515). The log
 * carries the failure message truncated to 500 chars — never chat/message content or
 * secrets; ids, names and counts only beyond that.
 *
 * Auth-gated (not open like `/v1/observability/*`) because this endpoint fans out to a Slack
 * webhook and an unauthenticated version would let anyone spam it. `kind` is checked against
 * an allowlist rather than accepted as free text so the endpoint cannot be used to inject
 * arbitrary alert text.
 *
 * No per-user rate limit is added here beyond auth: `alert()` itself rate-limits webhook
 * POSTs to one per kind per 60s regardless of caller, which is the spam protection this
 * endpoint actually needs (see #1680). Add a dedicated per-user limiter if usage patterns
 * later show one client hammering this route with distinct sessionId/error combinations.
 */
import { Elysia } from 'elysia';
import { z } from 'zod';

import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';

const ALLOWED_CLIENT_FAILURE_KINDS = [
  'lore_injection_failed',
  'scene_state_fetch_failed',
  'combat_intent_failed',
  'stale_client_detected',
  'malformed_ws_frame',
  'missing_starter_campaign_id',
  'invalid_ability_score_key',
  'unhandled_promise_rejection',
  'react_error_boundary',
] as const;
type ClientFailureKind = (typeof ALLOWED_CLIENT_FAILURE_KINDS)[number];

const isAllowedKind = (kind: string): kind is ClientFailureKind =>
  (ALLOWED_CLIENT_FAILURE_KINDS as readonly string[]).includes(kind);

/** The failure message is the one free-text field in the log line; cap it. */
const CLIENT_FAILURE_MESSAGE_MAX_CHARS = 500;

/**
 * The client-failure payload shape (#2515). Optional fields stay optional and unknown
 * fields are ignored (zod strips them) so a newer client never gets a rejection for
 * sending more than an older server knows — this types the payload, it does not tighten
 * what is accepted beyond the `kind` allowlist below.
 */
const clientFailurePayloadSchema = z.object({
  kind: z.string().min(1).max(100),
  sessionId: z.string().max(200).optional(),
  // The two free-text fields are truncated, never rejected: a failure carrying a
  // very long message (an HTML error page, a serialized response) is exactly the
  // report this endpoint exists for, and a 400 would drop it whole (#2515).
  error: z
    .string()
    .transform((value) => value.slice(0, 2_000))
    .optional(),
  message: z
    .string()
    .transform((value) => value.slice(0, 4_000))
    .optional(),
  component: z.string().max(200).optional(),
  route: z.string().max(500).optional(),
  bundle: z.string().max(200).optional(),
  clientTimestamp: z.string().max(64).optional(),
});

export const telemetryRoutes = new Elysia({ prefix: '/v1/telemetry' }).use(requireAuth).post(
  '/client-failure',
  ({ body, user }) => {
    const parsed = clientFailurePayloadSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid client-failure payload.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const payload = parsed.data;

    if (!isAllowedKind(payload.kind)) {
      return new Response(
        JSON.stringify({
          error: `Invalid kind. Must be one of: ${ALLOWED_CLIENT_FAILURE_KINDS.join(', ')}`,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    logger.info({
      msg: 'CLIENT_FAILURE',
      sessionId: payload.sessionId,
      userId: user?.userId,
      kind: payload.kind,
      message: (payload.message ?? payload.error)?.slice(0, CLIENT_FAILURE_MESSAGE_MAX_CHARS),
      component: payload.component,
      route: payload.route,
      bundle: payload.bundle,
      clientTimestamp: payload.clientTimestamp,
    });

    alert(payload.kind, {
      sessionId: payload.sessionId,
      error: payload.error ?? payload.message,
    });

    return new Response(null, { status: 204 });
  },
);
