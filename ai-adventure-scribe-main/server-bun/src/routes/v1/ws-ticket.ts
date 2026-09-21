import { Elysia } from 'elysia';

import { requireAuth } from '../../middleware/auth.js';
import { mintWsTicket } from '../../services/ws-ticket.js';

const SESSION_ID_MAX_LENGTH = 200;

function readSessionId(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const sessionId = (body as { sessionId?: unknown }).sessionId;
  if (typeof sessionId !== 'string') return null;
  const trimmed = sessionId.trim();
  if (!trimmed || trimmed.length > SESSION_ID_MAX_LENGTH) return null;
  return trimmed;
}

/**
 * POST /v1/ws/ticket
 *
 * Authenticated with the normal bearer token. Returns a short-lived one-time
 * ticket for the `/ws` upgrade. The access token itself never appears in the
 * WebSocket URL.
 *
 * Body is validated in the handler, not via a TypeBox schema: Elysia parses
 * `body: t.Object(...)` before `requireAuth` (a `.resolve()` hook) runs, so a
 * missing body used to 422 "Internal Server Error" for unauthenticated callers
 * (#2120).
 */
export const wsTicketRoutes = new Elysia({ prefix: '/v1/ws' })
  .use(requireAuth)
  .post('/ticket', ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized', code: 'unauthorized' };
    }
    const sessionId = readSessionId(body);
    if (!sessionId) {
      set.status = 400;
      return { error: 'sessionId is required' };
    }
    return mintWsTicket({
      userId: user.userId,
      email: user.email,
      sessionId,
    });
  });
