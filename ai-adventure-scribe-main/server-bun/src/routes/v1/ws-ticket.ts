import { Elysia, t } from 'elysia';

import { requireAuth } from '../../middleware/auth.js';
import { mintWsTicket } from '../../services/ws-ticket.js';

/**
 * POST /v1/ws/ticket
 *
 * Authenticated with the normal bearer token. Returns a short-lived one-time
 * ticket for the `/ws` upgrade. The access token itself never appears in the
 * WebSocket URL.
 */
export const wsTicketRoutes = new Elysia({ prefix: '/v1/ws' }).use(requireAuth).post(
  '/ticket',
  ({ user, body, set }) => {
    if (!user) {
      set.status = 401;
      return { error: 'Unauthorized', code: 'unauthorized' };
    }
    const sessionId = body.sessionId?.trim() || 'lobby';
    return mintWsTicket({
      userId: user.userId,
      email: user.email,
      sessionId,
    });
  },
  {
    body: t.Object({
      sessionId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    }),
  },
);
