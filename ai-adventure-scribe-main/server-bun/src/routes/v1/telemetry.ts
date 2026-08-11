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
import { Elysia, t } from 'elysia';

import { alert } from '../../lib/alerting.js';
import { requireAuth } from '../../middleware/auth.js';

const ALLOWED_CLIENT_FAILURE_KINDS = [
  'lore_injection_failed',
  'scene_state_fetch_failed',
  'combat_intent_failed',
] as const;
type ClientFailureKind = (typeof ALLOWED_CLIENT_FAILURE_KINDS)[number];

const isAllowedKind = (kind: string): kind is ClientFailureKind =>
  (ALLOWED_CLIENT_FAILURE_KINDS as readonly string[]).includes(kind);

export const telemetryRoutes = new Elysia({ prefix: '/v1/telemetry' })
  .use(requireAuth)
  .post(
    '/client-failure',
    ({ body }) => {
      if (!isAllowedKind(body.kind)) {
        return new Response(
          JSON.stringify({
            error: `Invalid kind. Must be one of: ${ALLOWED_CLIENT_FAILURE_KINDS.join(', ')}`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      alert(body.kind, { sessionId: body.sessionId, error: body.error });

      return new Response(null, { status: 204 });
    },
    {
      body: t.Object({
        kind: t.String({ minLength: 1, maxLength: 100 }),
        sessionId: t.Optional(t.String({ maxLength: 200 })),
        error: t.Optional(t.String({ maxLength: 2_000 })),
      }),
    },
  );
